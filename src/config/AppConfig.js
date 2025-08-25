require('dotenv').config();

/**
 * Configuration management for the visa appointment scheduler
 */
class AppConfig {
  constructor() {
    this.config = {
      // Visa credentials
      user: process.env.VISA_USER,
      password: process.env.VISA_PASS,
      
      // Appointment preferences
      consulate: process.env.VISA_CONSULATE || 'Brasília',
      maxDate: process.env.VISA_MAX_DATE || '31-12-2025',
      refreshInterval: parseInt(process.env.VISA_REFRESH_INTERVAL || '30') * 1000,
      
      // Telegram configuration
      telegram: {
        botToken: process.env.TELEGRAM_BOT_TOKEN,
        chatId: process.env.TELEGRAM_CHAT_ID,
        enabled: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID)
      },
      
      // Browser configurations for fallback
      browserConfigs: [
        // Standard configuration
        {
          headless: false,
          args: ['--disable-web-security', '--disable-features=VizDisplayCompositor']
        },
        // Container/Docker friendly
        {
          headless: false,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu'
          ]
        },
        // Maximum compatibility (headless)
        {
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--disable-extensions'
          ]
        }
      ],
      
      // URLs
      urls: {
        login: 'https://ais.usvisa-info.com/pt-br/niv/users/sign_in',
        appointment: 'https://ais.usvisa-info.com/pt-br/niv/schedule/70146646/appointment'
      },
      
      // Consulate mappings
      consulateMappings: {
        'Brasília': '54',
        'Porto Alegre': '128',
        'Recife': '57',
        'Rio de Janeiro': '55',
        'São Paulo': '56'
      },
      
      // CASV location mappings
      casvMappings: {
        'Brasília': '58',        // Brasília ASC
        'Porto Alegre': '58',    // Brasília ASC (Porto Alegre uses Brasília)
        'Recife': '58',          // Brasília ASC (Recife uses Brasília)
        'Rio de Janeiro': '59',  // Rio de Janeiro ASC
        'São Paulo': '60'        // Sao Paulo ASC Unidade Vila Mariana
      },
      
      // Monitoring settings
      monitoring: {
        maxMonthsToCheck: 12,
        maxCasvMonthsToCheck: 12,
        casvDateTolerance: 2, // ±2 days for CASV date matching
        pageLoadTimeout: 30000,
        elementWaitTimeout: 10000,
        actionDelay: 1000,
        selectionDelay: 2000,
        calendarDelay: 2000
      }
    };
    
    this.validate();
  }
  
  /**
   * Validate required configuration
   */
  validate() {
    const required = ['user', 'password'];
    const missing = required.filter(key => !this.config[key]);
    
    if (missing.length > 0) {
      throw new Error(`Missing required configuration: ${missing.join(', ')}`);
    }
    
    if (!this.config.consulateMappings[this.config.consulate]) {
      throw new Error(`Unknown consulate: ${this.config.consulate}`);
    }
  }
  
  /**
   * Get configuration value by path
   * @param {string} path - Dot notation path (e.g., 'telegram.enabled')
   * @returns {*} Configuration value
   */
  get(path) {
    return path.split('.').reduce((obj, key) => obj?.[key], this.config);
  }
  
  /**
   * Get all configuration
   * @returns {object} Complete configuration object
   */
  getAll() {
    return { ...this.config };
  }
  
  /**
   * Get consulate value for HTML form
   * @returns {string} Consulate value
   */
  getConsulateValue() {
    return this.config.consulateMappings[this.config.consulate];
  }
  
  /**
   * Get CASV value for HTML form
   * @returns {string} CASV value
   */
  getCasvValue() {
    return this.config.casvMappings[this.config.consulate];
  }
  
  /**
   * Print configuration summary
   */
  printSummary() {
    console.log(`🚀 Starting Visa Appointment Monitor`);
    console.log(`📍 Consulate: ${this.config.consulate}`);
    console.log(`📅 Max Date: ${this.config.maxDate}`);
    console.log(`🔄 Refresh Interval: ${this.config.refreshInterval / 1000} seconds`);
    console.log(`📱 Telegram notifications: ${this.config.telegram.enabled ? 'enabled' : 'disabled'}`);
    console.log(`⏰ Started at: ${new Date().toLocaleString()}`);
  }
}

module.exports = AppConfig;