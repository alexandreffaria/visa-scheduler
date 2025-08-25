const TelegramBot = require('node-telegram-bot-api');

/**
 * Telegram notification system for visa appointment alerts
 */
class TelegramNotifier {
  constructor(config) {
    this.config = config;
    this.bot = null;
    this.isEnabled = config.get('telegram.enabled');
    
    if (this.isEnabled) {
      this._initializeBot();
    }
  }
  
  /**
   * Initialize the Telegram bot
   * @private
   */
  _initializeBot() {
    try {
      const botToken = this.config.get('telegram.botToken');
      this.bot = new TelegramBot(botToken, { polling: false });
      console.log(`📱 Telegram notifications enabled`);
    } catch (error) {
      console.log(`⚠️ Failed to initialize Telegram bot: ${error.message}`);
      this.isEnabled = false;
    }
  }
  
  /**
   * Send a notification message
   * @param {string} message - Message to send
   * @returns {Promise<boolean>} True if message was sent successfully
   */
  async sendNotification(message) {
    if (!this.isEnabled) {
      console.log(`📱 Telegram notifications disabled, skipping message`);
      return false;
    }
    
    if (!this.bot) {
      console.log(`⚠️ Telegram bot not initialized`);
      return false;
    }
    
    try {
      const chatId = this.config.get('telegram.chatId');
      await this.bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
      console.log(`📱 Telegram notification sent successfully`);
      return true;
    } catch (error) {
      console.log(`⚠️ Failed to send Telegram notification: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Send appointment found notification
   * @param {object} booking - Booking information
   * @param {number} checkCount - Current check count
   * @returns {Promise<boolean>} True if notification was sent successfully
   */
  async sendAppointmentFound(booking, checkCount = 0) {
    const consulate = this.config.get('consulate');
    
    let message;
    if (booking.isImprovement) {
      message = this._formatImprovementMessage(booking, consulate, checkCount);
    } else {
      message = this._formatAppointmentMessage(booking, consulate, checkCount);
    }
    
    return await this.sendNotification(message);
  }
  
  /**
   * Format improvement notification message
   * @private
   * @param {object} booking - Booking information
   * @param {string} consulate - Consulate name
   * @param {number} checkCount - Check count
   * @returns {string} Formatted message
   */
  _formatImprovementMessage(booking, consulate, checkCount) {
    return `
<b>🏆 NEW EARLIER APPOINTMENT FOUND! 🏆</b>

📍 <b>Consulate:</b> ${consulate}
📅 <b>Consulate Date:</b> ${booking.consulate.date}
⏰ <b>Consulate Time:</b> ${booking.consulate.time}
🏢 <b>CASV Date:</b> ${booking.casv.date}
⏰ <b>CASV Time:</b> ${booking.casv.time}

${booking.previousBest ? `📈 <b>Previous best date:</b> ${booking.previousBest}` : '🎯 <b>This is the first appointment found!</b>'}

⏰ <b>Found at:</b> ${new Date().toLocaleString()}
🔄 <b>Check #:</b> ${checkCount}
    `.trim();
  }
  
  /**
   * Format regular appointment notification message
   * @private
   * @param {object} booking - Booking information
   * @param {string} consulate - Consulate name
   * @param {number} checkCount - Check count
   * @returns {string} Formatted message
   */
  _formatAppointmentMessage(booking, consulate, checkCount) {
    return `
<b>🎉 VISA APPOINTMENT FOUND! 🎉</b>

📍 <b>Consulate:</b> ${consulate}
📅 <b>Consulate Date:</b> ${booking.consulate.date}
⏰ <b>Consulate Time:</b> ${booking.consulate.time}
🏢 <b>CASV Date:</b> ${booking.casv.date}
⏰ <b>CASV Time:</b> ${booking.casv.time}

⏰ <b>Found at:</b> ${new Date().toLocaleString()}
🔄 <b>Check #:</b> ${checkCount}
    `.trim();
  }
  
  /**
   * Send system startup notification
   * @returns {Promise<boolean>} True if notification was sent successfully
   */
  async sendStartupNotification() {
    const consulate = this.config.get('consulate');
    const maxDate = this.config.get('maxDate');
    const refreshInterval = this.config.get('refreshInterval') / 1000;
    
    const message = `
<b>🚀 VISA SCHEDULER STARTED</b>

📍 <b>Consulate:</b> ${consulate}
📅 <b>Max Date:</b> ${maxDate}
🔄 <b>Refresh Interval:</b> ${refreshInterval} seconds
⏰ <b>Started at:</b> ${new Date().toLocaleString()}

The system is now monitoring for appointment availability.
    `.trim();
    
    return await this.sendNotification(message);
  }
  
  /**
   * Send system error notification
   * @param {Error} error - Error that occurred
   * @param {string} context - Context where error occurred
   * @returns {Promise<boolean>} True if notification was sent successfully
   */
  async sendErrorNotification(error, context = 'Unknown') {
    const message = `
<b>⚠️ VISA SCHEDULER ERROR</b>

🔴 <b>Context:</b> ${context}
📝 <b>Error:</b> ${error.message}
⏰ <b>Occurred at:</b> ${new Date().toLocaleString()}

The system may need attention.
    `.trim();
    
    return await this.sendNotification(message);
  }
  
  /**
   * Send system shutdown notification
   * @param {string} reason - Reason for shutdown
   * @returns {Promise<boolean>} True if notification was sent successfully
   */
  async sendShutdownNotification(reason = 'Manual stop') {
    const message = `
<b>🛑 VISA SCHEDULER STOPPED</b>

📝 <b>Reason:</b> ${reason}
⏰ <b>Stopped at:</b> ${new Date().toLocaleString()}

The monitoring system has been stopped.
    `.trim();
    
    return await this.sendNotification(message);
  }
  
  /**
   * Send daily summary notification
   * @param {object} summary - Daily summary data
   * @returns {Promise<boolean>} True if notification was sent successfully
   */
  async sendDailySummary(summary) {
    const message = `
<b>📊 DAILY SUMMARY</b>

🔄 <b>Total Checks:</b> ${summary.totalChecks}
📅 <b>Appointments Found:</b> ${summary.appointmentsFound}
🏆 <b>Best Date:</b> ${summary.bestDate || 'None found'}
⏰ <b>Runtime:</b> ${summary.runtime}
📱 <b>Last Check:</b> ${new Date().toLocaleString()}

Monitoring continues...
    `.trim();
    
    return await this.sendNotification(message);
  }
  
  /**
   * Send session timeout notification
   * @returns {Promise<boolean>} True if notification was sent successfully
   */
  async sendSessionTimeoutNotification() {
    const message = `
<b>🔐 SESSION TIMEOUT</b>

The login session has expired and the system is attempting to re-authenticate.

⏰ <b>Occurred at:</b> ${new Date().toLocaleString()}
    `.trim();
    
    return await this.sendNotification(message);
  }
  
  /**
   * Send test notification to verify setup
   * @returns {Promise<boolean>} True if notification was sent successfully
   */
  async sendTestNotification() {
    const message = `
<b>🧪 TEST NOTIFICATION</b>

This is a test message to verify Telegram notifications are working correctly.

⏰ <b>Sent at:</b> ${new Date().toLocaleString()}
✅ <b>Status:</b> Configuration is working!
    `.trim();
    
    return await this.sendNotification(message);
  }
  
  /**
   * Check if notifications are enabled
   * @returns {boolean} True if notifications are enabled
   */
  isNotificationEnabled() {
    return this.isEnabled;
  }
  
  /**
   * Get notification configuration status
   * @returns {object} Configuration status
   */
  getStatus() {
    return {
      enabled: this.isEnabled,
      botInitialized: !!this.bot,
      hasToken: !!this.config.get('telegram.botToken'),
      hasChatId: !!this.config.get('telegram.chatId')
    };
  }
  
  /**
   * Disable notifications (useful for testing)
   */
  disable() {
    this.isEnabled = false;
    console.log(`📱 Telegram notifications disabled`);
  }
  
  /**
   * Enable notifications
   */
  enable() {
    if (this.config.get('telegram.enabled')) {
      this.isEnabled = true;
      if (!this.bot) {
        this._initializeBot();
      }
      console.log(`📱 Telegram notifications enabled`);
    } else {
      console.log(`⚠️ Cannot enable notifications: missing configuration`);
    }
  }
}

module.exports = TelegramNotifier;