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
      
      // Check for existing appointments
      await this._checkExistingAppointments();
      
      // Navigate to the appointment scheduling page
      console.log(`\n🔍 Navigating to appointment scheduling page...`);
      const appointmentUrl = this.config.get('urls.appointment');
      await this.browser.navigateTo(appointmentUrl);
      await this.browser.wait(3000);
      console.log(`✅ Successfully navigated to appointment page`);
      
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
    
    // Show the baseline date that's being used for comparison
    const baselineDate = this.booker.getBaselineDate();
    if (baselineDate) {
      console.log(`🎯 Baseline date (existing appointment): ${baselineDate} - only better dates will trigger notifications`);
    }
    
    try {
      // Refresh the page to get latest availability
      await this.browser.reload();
      console.log(`🔄 Page refreshed`);
      
      // Attempt to book an appointment
      const booking = await this.booker.attemptBooking();
      
      if (booking) {
        this.appointmentsFound++;
        
        // Print booking success
        if (booking.isImprovement) {
          this.booker.printBookingSuccess(booking);
        } else {
          const ref = this.booker.getBaselineDate() || this.booker.getBestDateFound() || this.config.get('maxDate');
          console.log(`ℹ️ Found available date ${booking.consulate.date}, but it's not better than ${ref}. No booking or notification.`);
        }

        // Notifications remain strictly "improvement only"
        if (booking.isImprovement) {
          const notificationSent = await this.notifier.sendAppointmentFound(booking, this.checkCount);
          if (notificationSent) {
            console.log(`📱 Telegram notification sent for improved date`);
          }
        } else {
          const ref = this.booker.getBaselineDate() || this.booker.getBestDateFound() || this.config.get('maxDate');
          console.log(`📱 Skipping notification - not an improved date (${booking.consulate.date} vs best: ${ref})`);
        }
        
        // NOTE: This appears to be a duplicate notification block - removing to avoid double notifications
        
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
  
  /**
   * Check for existing scheduled appointments
   * @private
   */
  async _checkExistingAppointments() {
    try {
      console.log(`🔍 Checking for existing scheduled appointments...`);
      
      // Extract the group ID from the current URL after login
      const currentUrl = await this.browser.getCurrentUrl();
      let groupId = '';
      
      try {
        // Try to extract group ID from the URL
        const groupMatch = currentUrl.match(/\/groups\/(\d+)/i);
        if (groupMatch && groupMatch[1]) {
          groupId = groupMatch[1];
          console.log(`📁 Found group ID from URL: ${groupId}`);
        } else {
          // Fallback to configuration if URL extraction fails
          console.log(`⚠️ Could not extract group ID from URL: ${currentUrl}`);
          groupId = '49414116'; // Fallback to default
          console.log(`⚠️ Using fallback group ID: ${groupId}`);
        }
      } catch (error) {
        console.log(`⚠️ Error extracting group ID: ${error.message}`);
        groupId = '49414116'; // Fallback to default
      }
      
      // Navigate to the appointments page
      const appointmentsUrl = `https://ais.usvisa-info.com/pt-br/niv/groups/${groupId}`;
      console.log(`🔍 Navigating to appointments page: ${appointmentsUrl}`);
      await this.browser.navigateTo(appointmentsUrl);
      await this.browser.wait(3000);
      
      // Look for appointment information using specific CSS classes
      const appointmentInfo = await this.browser.evaluate(() => {
        const result = {
          debug: {} // Add debug information
        };
        
        // Look for consular appointment in elements with class "consular-appt"
        const consularElement = document.querySelector('.consular-appt');
        if (consularElement) {
          const consularText = consularElement.textContent || consularElement.innerText;
          result.debug.consularText = consularText; // Save for debugging
          
          // Simple string manipulation approach
          try {
            // Strip prefix and extract the date part
            let dateText = consularText;
            if (dateText.includes('Agendamento consular:')) {
              dateText = dateText.split('Agendamento consular:')[1].trim();
            }
            
            // Parse the components - format will be like "29 Agosto, 2025, 10:30 Brasília"
            const parts = dateText.split(/[\s,]+/).filter(part => part.trim().length > 0);
            result.debug.consularParts = parts;
            
            if (parts.length >= 4) {
              const day = parts[0];
              const month = parts[1];
              const year = parts[2];
              const time = parts[3];
              
              // Extract location (everything after time)
              let location = 'Brasília';
              if (parts.length > 4) {
                location = parts.slice(4).join(' ').replace(/Horário local at/i, '').trim();
              }
              
              result.consulate = {
                day: day,
                month: month,
                year: year,
                time: time,
                location: location
              };
            } else {
              result.debug.consularParsingFailed = true;
            }
          } catch (e) {
            result.debug.consularError = e.toString();
            result.debug.consularParsingFailed = true;
          }
        } else {
          result.debug.consularElementNotFound = true;
        }
        
        // Look for CASV appointment in elements with class "asc-appt"
        const casvElement = document.querySelector('.asc-appt');
        if (casvElement) {
          const casvText = casvElement.textContent || casvElement.innerText;
          result.debug.casvText = casvText; // Save for debugging
          
          // Simple string manipulation approach
          try {
            // Strip prefix and extract the date part
            let dateText = casvText;
            if (dateText.includes('Agendamento no CASV:')) {
              dateText = dateText.split('Agendamento no CASV:')[1].trim();
            }
            
            // Parse the components - format will be like "29 Agosto, 2025, 08:00 Brasília"
            const parts = dateText.split(/[\s,]+/).filter(part => part.trim().length > 0);
            result.debug.casvParts = parts;
            
            if (parts.length >= 4) {
              const day = parts[0];
              const month = parts[1];
              const year = parts[2];
              const time = parts[3];
              
              // Extract location (everything after time)
              let location = 'ASC';
              if (parts.length > 4) {
                location = parts.slice(4).join(' ').replace(/Horário local at/i, '').trim();
              }
              
              result.casv = {
                day: day,
                month: month,
                year: year,
                time: time,
                location: location
              };
            } else {
              result.debug.casvParsingFailed = true;
            }
          } catch (e) {
            result.debug.casvError = e.toString();
            result.debug.casvParsingFailed = true;
          }
        } else {
          result.debug.casvElementNotFound = true;
        }
        
        // If nothing else worked, look for any paragraph that contains date information
        if (!result.consulate && !result.casv) {
          const allParagraphs = Array.from(document.querySelectorAll('p'));
          result.debug.paragraphsCount = allParagraphs.length;
          
          // Collect the text of the first 10 paragraphs for debugging
          result.debug.paragraphs = allParagraphs.slice(0, 10).map(p => p.textContent || p.innerText);
        }
        
        return result;
      });
      
      // Log debug information
      if (appointmentInfo?.debug) {
        console.log(`🔍 Debug information for appointment detection:`);
        if (appointmentInfo.debug.consularText) {
          console.log(`   Consular text: "${appointmentInfo.debug.consularText}"`);
        }
        if (appointmentInfo.debug.casvText) {
          console.log(`   CASV text: "${appointmentInfo.debug.casvText}"`);
        }
        if (appointmentInfo.debug.consularElementNotFound) {
          console.log(`   ⚠️ Consular element (.consular-appt) not found`);
        }
        if (appointmentInfo.debug.casvElementNotFound) {
          console.log(`   ⚠️ CASV element (.asc-appt) not found`);
        }
        if (appointmentInfo.debug.consularMatchFailed) {
          console.log(`   ⚠️ Failed to match date pattern in consular text`);
        }
        if (appointmentInfo.debug.casvMatchFailed) {
          console.log(`   ⚠️ Failed to match date pattern in CASV text`);
        }
        if (appointmentInfo.debug.paragraphs) {
          console.log(`   Found ${appointmentInfo.debug.paragraphsCount} paragraphs on page, first few are:`);
          appointmentInfo.debug.paragraphs.forEach((text, i) => {
            console.log(`     [${i}]: "${text.trim()}"`);
          });
        }
        
        // Clean up debug info before continuing
        delete appointmentInfo.debug;
      }
      
      if (appointmentInfo) {
        console.log(`📅 Found existing appointments:`);
        
        if (appointmentInfo.consulate) {
          const consularDate = this._parsePortugueseDate(appointmentInfo.consulate);
          appointmentInfo.consulate.date = consularDate;
          console.log(`   🏛️ Consular: ${consularDate} at ${appointmentInfo.consulate.time} - ${appointmentInfo.consulate.location}`);
        }
        
        if (appointmentInfo.casv) {
          const casvDate = this._parsePortugueseDate(appointmentInfo.casv);
          appointmentInfo.casv.date = casvDate;
          console.log(`   🏢 CASV: ${casvDate} at ${appointmentInfo.casv.time} - ${appointmentInfo.casv.location}`);
        }
        
        // Set existing appointments in booker
        this.booker.setExistingAppointments(appointmentInfo);
        
        console.log(`✅ Existing appointments loaded - will only notify for better dates than ${appointmentInfo.consulate.date}\n`);
      } else {
        console.log(`📅 No existing appointments found - will notify for any dates found\n`);
      }
      
    } catch (error) {
      console.log(`⚠️ Could not check existing appointments: ${error.message}`);
      console.log(`🔄 Continuing with monitoring...\n`);
    }
  }
  
  /**
   * Parse Portuguese date to DD-MM-YYYY format
   * @private
   * @param {object} dateObj - Date object with day, month (Portuguese), year
   * @returns {string} Formatted date string
   */
  _parsePortugueseDate(dateObj) {
    const monthMap = {
      'janeiro': '01', 'fevereiro': '02', 'março': '03', 'abril': '04',
      'maio': '05', 'junho': '06', 'julho': '07', 'agosto': '08',
      'setembro': '09', 'outubro': '10', 'novembro': '11', 'dezembro': '12'
    };
    
    const day = dateObj.day.padStart(2, '0');
    const monthKey = dateObj.month.toLowerCase();
    const month = monthMap[monthKey];
    
    if (!month) {
      console.log(`⚠️ Warning: Unknown Portuguese month '${dateObj.month}' - using '01'`);
      return `${day}-01-${dateObj.year}`;
    }
    
    const formattedDate = `${day}-${month}-${dateObj.year}`;
    console.log(`📅 Parsed Portuguese date: ${dateObj.day} ${dateObj.month}, ${dateObj.year} → ${formattedDate}`);
    
    return formattedDate;
  }
}

module.exports = VisaScheduler;