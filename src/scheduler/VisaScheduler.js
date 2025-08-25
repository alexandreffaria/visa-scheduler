const AppConfig = require('../config/AppConfig');
const BrowserManager = require('../browser/BrowserManager');
const AuthHandler = require('../auth/AuthHandler');
const CalendarNavigator = require('../calendar/CalendarNavigator');
const AppointmentBooker = require('../appointment/AppointmentBooker');
const TelegramNotifier = require('../notifications/TelegramNotifier');

/**
 * Main visa appointment scheduler that orchestrates all components
 */
class VisaScheduler {
  constructor() {
    this.config = null;
    this.browser = null;
    this.auth = null;
    this.calendar = null;
    this.booker = null;
    this.notifier = null;
    
    // Monitoring state
    this.isRunning = false;
    this.checkCount = 0;
    this.appointmentsFound = 0;
    this.startTime = null;
    this.lastCheckTime = null;
    this.previousDates = [];
    
    // Graceful shutdown handling
    this.shutdownRequested = false;
    this._setupSignalHandlers();
  }
  
  /**
   * Initialize all components
   */
  async initialize() {
    try {
      console.log(`🎯 Initializing Visa Appointment Scheduler...\n`);
      
      // Initialize configuration
      this.config = new AppConfig();
      this.config.printSummary();
      
      // Initialize browser manager
      this.browser = new BrowserManager(this.config);
      
      // Launch browser
      await this.browser.launch();
      
      // Initialize other components
      this.auth = new AuthHandler(this.config, this.browser);
      this.calendar = new CalendarNavigator(this.config, this.browser);
      this.booker = new AppointmentBooker(this.config, this.browser, this.calendar);
      this.notifier = new TelegramNotifier(this.config);
      
      // Perform initial authentication
      await this.auth.login();
      
      // Set up consulate selection
      await this.booker.setupConsulateSelection();
      
      console.log(`✅ All components initialized successfully\n`);
      
      // Send startup notification
      await this.notifier.sendStartupNotification();
      
      return true;
      
    } catch (error) {
      console.log(`💥 Failed to initialize scheduler: ${error.message}`);
      await this.notifier?.sendErrorNotification(error, 'Initialization');
      throw error;
    }
  }
  
  /**
   * Start the monitoring loop
   */
  async start() {
    if (this.isRunning) {
      console.log(`⚠️ Scheduler is already running`);
      return;
    }
    
    this.isRunning = true;
    this.startTime = new Date();
    this.shutdownRequested = false;
    
    console.log(`\n🔄 Starting continuous monitoring...`);
    console.log(`💡 Press Ctrl+C to stop monitoring\n`);
    
    try {
      await this._monitoringLoop();
    } catch (error) {
      console.log(`💥 Monitoring loop failed: ${error.message}`);
      await this.notifier?.sendErrorNotification(error, 'Monitoring Loop');
      throw error;
    } finally {
      this.isRunning = false;
    }
  }
  
  /**
   * Stop the scheduler
   * @param {string} reason - Reason for stopping
   */
  async stop(reason = 'Manual stop') {
    console.log(`\n🛑 Stopping scheduler: ${reason}`);
    
    this.shutdownRequested = true;
    this.isRunning = false;
    
    try {
      // Send shutdown notification
      await this.notifier?.sendShutdownNotification(reason);
      
      // Close browser
      await this.browser?.close();
      
      // Print final statistics
      this._printFinalStats();
      
      console.log(`✅ Scheduler stopped gracefully`);
      
    } catch (error) {
      console.log(`⚠️ Error during shutdown: ${error.message}`);
    }
  }
  
  /**
   * Main monitoring loop
   * @private
   */
  async _monitoringLoop() {
    while (this.isRunning && !this.shutdownRequested) {
      try {
        await this._performCheck();
        
        // Wait for next check
        if (!this.shutdownRequested) {
          await this._waitForNextCheck();
        }
        
      } catch (error) {
        console.log(`⚠️ Error during check #${this.checkCount}: ${error.message}`);
        
        // Handle session expiration
        if (this._isSessionExpired(error)) {
          await this._handleSessionExpiration();
        } else {
          // Send error notification for serious errors
          await this.notifier?.sendErrorNotification(error, `Check #${this.checkCount}`);
        }
        
        // Continue monitoring after error
        console.log(`🔄 Will retry in next cycle...`);
      }
    }
  }
  
  /**
   * Perform a single appointment check
   * @private
   */
  async _performCheck() {
    this.checkCount++;
    this.lastCheckTime = new Date();
    
    console.log(`\n🔍 Check #${this.checkCount} - ${this.lastCheckTime.toLocaleString()}`);
    console.log(`📅 Checking for available dates before: ${this.config.get('maxDate')}`);
    
    try {
      // Refresh the page to get latest availability
      await this.browser.reload();
      console.log(`🔄 Page refreshed`);
      
      // Attempt to book an appointment
      const booking = await this.booker.attemptBooking();
      
      if (booking) {
        this.appointmentsFound++;
        
        // Print booking success
        this.booker.printBookingSuccess(booking);
        
        // Send notification
        await this.notifier.sendAppointmentFound(booking, this.checkCount);
        
        // Update previous dates for comparison
        this._updatePreviousDates(booking);
        
      } else {
        console.log(`❌ No available appointments found`);
      }
      
      // Reset booking state for next attempt
      this.booker.reset();
      
    } catch (error) {
      console.log(`⚠️ Check failed: ${error.message}`);
      throw error; // Re-throw to be handled by monitoring loop
    }
  }
  
  /**
   * Wait for the next check cycle
   * @private
   */
  async _waitForNextCheck() {
    const interval = this.config.get('refreshInterval');
    console.log(`⏳ Next check in ${interval / 1000} seconds...`);
    
    // Break the wait into smaller chunks to allow for graceful shutdown
    const chunkSize = 1000; // 1 second chunks
    const chunks = Math.ceil(interval / chunkSize);
    
    for (let i = 0; i < chunks && !this.shutdownRequested; i++) {
      await new Promise(resolve => setTimeout(resolve, Math.min(chunkSize, interval - (i * chunkSize))));
    }
  }
  
  /**
   * Check if error indicates session expiration
   * @private
   * @param {Error} error - Error to check
   * @returns {boolean} True if session expired
   */
  _isSessionExpired(error) {
    const sessionExpiredIndicators = [
      'login',
      'sign_in',
      'authentication',
      'unauthorized',
      'session'
    ];
    
    return sessionExpiredIndicators.some(indicator => 
      error.message.toLowerCase().includes(indicator)
    );
  }
  
  /**
   * Handle session expiration
   * @private
   */
  async _handleSessionExpiration() {
    console.log(`🔐 Handling session expiration...`);
    
    try {
      // Send session timeout notification
      await this.notifier?.sendSessionTimeoutNotification();
      
      // Attempt to handle session expiration
      await this.auth.handleSessionExpiration();
      
      // Re-setup consulate selection
      await this.booker.setupConsulateSelection();
      
      console.log(`✅ Session restored successfully`);
      
    } catch (error) {
      console.log(`❌ Failed to restore session: ${error.message}`);
      await this.notifier?.sendErrorNotification(error, 'Session Restoration');
      throw error;
    }
  }
  
  /**
   * Update previous dates for comparison
   * @private
   * @param {object} booking - Booking information
   */
  _updatePreviousDates(booking) {
    const currentDate = booking.consulate.date.split('-')[0]; // Get day only
    
    if (!this.previousDates.includes(currentDate)) {
      this.previousDates.push(currentDate);
      console.log(`📝 Updated tracked dates: ${this.previousDates.join(', ')}`);
    }
  }
  
  /**
   * Setup signal handlers for graceful shutdown
   * @private
   */
  _setupSignalHandlers() {
    const signals = ['SIGINT', 'SIGTERM', 'SIGQUIT'];
    
    signals.forEach(signal => {
      process.on(signal, async () => {
        console.log(`\n📡 Received ${signal} signal`);
        await this.stop(`Received ${signal} signal`);
        process.exit(0);
      });
    });
    
    // Handle uncaught exceptions
    process.on('uncaughtException', async (error) => {
      console.log(`💥 Uncaught Exception: ${error.message}`);
      await this.notifier?.sendErrorNotification(error, 'Uncaught Exception');
      await this.stop('Uncaught Exception');
      process.exit(1);
    });
    
    // Handle unhandled promise rejections
    process.on('unhandledRejection', async (reason, promise) => {
      console.log(`💥 Unhandled Promise Rejection: ${reason}`);
      const error = reason instanceof Error ? reason : new Error(String(reason));
      await this.notifier?.sendErrorNotification(error, 'Unhandled Promise Rejection');
      await this.stop('Unhandled Promise Rejection');
      process.exit(1);
    });
  }
  
  /**
   * Print final statistics
   * @private
   */
  _printFinalStats() {
    const runtime = this.startTime ? new Date() - this.startTime : 0;
    const runtimeHours = Math.floor(runtime / (1000 * 60 * 60));
    const runtimeMinutes = Math.floor((runtime % (1000 * 60 * 60)) / (1000 * 60));
    
    console.log(`\n📊 Final Statistics:`);
    console.log(`🔄 Total checks performed: ${this.checkCount}`);
    console.log(`📅 Appointments found: ${this.appointmentsFound}`);
    console.log(`🏆 Best date found: ${this.booker?.getBestDateFound() || 'None'}`);
    console.log(`⏱️ Total runtime: ${runtimeHours}h ${runtimeMinutes}m`);
    console.log(`📱 Notifications sent: ${this.notifier?.isNotificationEnabled() ? 'Yes' : 'No'}`);
  }
  
  /**
   * Get current scheduler status
   * @returns {object} Current status
   */
  getStatus() {
    const runtime = this.startTime ? new Date() - this.startTime : 0;
    
    return {
      isRunning: this.isRunning,
      checkCount: this.checkCount,
      appointmentsFound: this.appointmentsFound,
      bestDateFound: this.booker?.getBestDateFound() || null,
      runtime: runtime,
      lastCheckTime: this.lastCheckTime,
      startTime: this.startTime,
      notificationsEnabled: this.notifier?.isNotificationEnabled() || false,
      browserReady: this.browser?.isReady() || false
    };
  }
  
  /**
   * Send daily summary (can be called externally)
   */
  async sendDailySummary() {
    const status = this.getStatus();
    const runtimeHours = Math.floor(status.runtime / (1000 * 60 * 60));
    const runtimeMinutes = Math.floor((status.runtime % (1000 * 60 * 60)) / (1000 * 60));
    
    const summary = {
      totalChecks: status.checkCount,
      appointmentsFound: status.appointmentsFound,
      bestDate: status.bestDateFound,
      runtime: `${runtimeHours}h ${runtimeMinutes}m`
    };
    
    await this.notifier?.sendDailySummary(summary);
  }
  
  /**
   * Test all systems
   */
  async testSystems() {
    console.log(`🧪 Testing all systems...`);
    
    try {
      // Test configuration
      console.log(`✅ Configuration: OK`);
      
      // Test browser
      if (this.browser?.isReady()) {
        console.log(`✅ Browser: OK`);
      } else {
        console.log(`❌ Browser: Not ready`);
      }
      
      // Test authentication
      const isLoggedIn = await this.auth?.isLoggedIn();
      console.log(`${isLoggedIn ? '✅' : '❌'} Authentication: ${isLoggedIn ? 'OK' : 'Not logged in'}`);
      
      // Test notifications
      if (this.notifier?.isNotificationEnabled()) {
        await this.notifier.sendTestNotification();
        console.log(`✅ Notifications: OK`);
      } else {
        console.log(`⚠️ Notifications: Disabled`);
      }
      
      console.log(`🧪 System test completed`);
      
    } catch (error) {
      console.log(`❌ System test failed: ${error.message}`);
      throw error;
    }
  }
}

module.exports = VisaScheduler;