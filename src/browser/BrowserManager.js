const puppeteer = require('puppeteer');

/**
 * Browser management with retry logic and fallback configurations
 */
class BrowserManager {
  constructor(config) {
    this.config = config;
    this.browser = null;
    this.page = null;
  }
  
  /**
   * Launch browser with retry logic using different configurations
   * @returns {Promise<{browser: Browser, page: Page}>}
   */
  async launch() {
    const browserConfigs = this.config.get('browserConfigs');
    
    for (let i = 0; i < browserConfigs.length; i++) {
      try {
        console.log(`🚀 Attempting to launch browser (config ${i + 1}/${browserConfigs.length})...`);
        
        this.browser = await puppeteer.launch(browserConfigs[i]);
        this.page = await this.browser.newPage();
        
        console.log(`✅ Browser launched successfully with config ${i + 1}`);
        return { browser: this.browser, page: this.page };
        
      } catch (error) {
        console.log(`❌ Browser launch failed with config ${i + 1}: ${error.message}`);
        
        if (i === browserConfigs.length - 1) {
          console.log(`💥 All browser launch attempts failed. This could be due to:`);
          console.log(`   • Missing Chrome/Chromium installation`);
          console.log(`   • Running in restricted environment (Docker/WSL)`);
          console.log(`   • System compatibility issues`);
          console.log(`\n🔧 Try installing Chrome: sudo apt-get install google-chrome-stable`);
          console.log(`🔧 Or try running with --no-sandbox: PUPPETEER_ARGS="--no-sandbox" node main.js`);
          throw new Error('Failed to launch browser with all configurations');
        }
      }
    }
  }
  
  /**
   * Navigate to a URL with timeout and error handling
   * @param {string} url - URL to navigate to
   * @param {object} options - Navigation options
   */
  async navigateTo(url, options = {}) {
    if (!this.page) {
      throw new Error('Browser page not initialized');
    }
    
    const defaultOptions = {
      waitUntil: 'networkidle2',
      timeout: this.config.get('monitoring.pageLoadTimeout')
    };
    
    const navOptions = { ...defaultOptions, ...options };
    
    console.log(`🔗 Navigating to: ${url}`);
    await this.page.goto(url, navOptions);
  }
  
  /**
   * Wait for selector with configurable timeout
   * @param {string} selector - CSS selector to wait for
   * @param {number} timeout - Custom timeout (optional)
   */
  async waitForSelector(selector, timeout = null) {
    if (!this.page) {
      throw new Error('Browser page not initialized');
    }
    
    const waitTimeout = timeout || this.config.get('monitoring.elementWaitTimeout');
    await this.page.waitForSelector(selector, { timeout: waitTimeout });
  }
  
  /**
   * Type text into an input field
   * @param {string} selector - CSS selector for the input
   * @param {string} text - Text to type
   */
  async typeText(selector, text) {
    if (!this.page) {
      throw new Error('Browser page not initialized');
    }
    
    await this.page.type(selector, text);
  }
  
  /**
   * Click on an element
   * @param {string} selector - CSS selector for the element
   */
  async click(selector) {
    if (!this.page) {
      throw new Error('Browser page not initialized');
    }
    
    await this.page.click(selector);
  }
  
  /**
   * Select option from dropdown
   * @param {string} selector - CSS selector for the select element
   * @param {string} value - Value to select
   */
  async select(selector, value) {
    if (!this.page) {
      throw new Error('Browser page not initialized');
    }
    
    await this.page.select(selector, value);
  }
  
  /**
   * Reload the current page
   * @param {object} options - Reload options
   */
  async reload(options = {}) {
    if (!this.page) {
      throw new Error('Browser page not initialized');
    }
    
    const defaultOptions = {
      waitUntil: 'networkidle2',
      timeout: this.config.get('monitoring.pageLoadTimeout')
    };
    
    const reloadOptions = { ...defaultOptions, ...options };
    
    console.log(`🔄 Reloading page...`);
    await this.page.reload(reloadOptions);
  }
  
  /**
   * Execute JavaScript in the browser context
   * @param {Function|string} fn - Function or script to execute
   * @param {...any} args - Arguments to pass to the function
   */
  async evaluate(fn, ...args) {
    if (!this.page) {
      throw new Error('Browser page not initialized');
    }
    
    return await this.page.evaluate(fn, ...args);
  }
  
  /**
   * Get all elements matching a selector
   * @param {string} selector - CSS selector
   * @returns {Promise<Array>} Array of element handles
   */
  async findElements(selector) {
    if (!this.page) {
      throw new Error('Browser page not initialized');
    }
    
    return await this.page.$$(selector);
  }
  
  /**
   * Get element property or text content
   * @param {string} selector - CSS selector
   * @param {string} property - Property to get (optional, defaults to textContent)
   */
  async getElementInfo(selector, property = 'textContent') {
    if (!this.page) {
      throw new Error('Browser page not initialized');
    }
    
    return await this.page.$eval(selector, (el, prop) => {
      if (prop === 'textContent') {
        return el.textContent?.trim();
      } else if (prop === 'className') {
        return el.className;
      } else if (prop === 'value') {
        return el.value;
      } else {
        return el.getAttribute(prop);
      }
    }, property);
  }
  
  /**
   * Get information from multiple elements
   * @param {string} selector - CSS selector
   * @param {Function} mapFunction - Function to extract data from each element
   */
  async getElementsInfo(selector, mapFunction) {
    if (!this.page) {
      throw new Error('Browser page not initialized');
    }
    
    return await this.page.$$eval(selector, mapFunction);
  }
  
  /**
   * Wait for a specified amount of time
   * @param {number} ms - Milliseconds to wait
   */
  async wait(ms) {
    await new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Close the browser
   */
  async close() {
    if (this.browser) {
      console.log(`🔒 Closing browser...`);
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }
  
  /**
   * Get current page instance
   * @returns {Page} Current page instance
   */
  getPage() {
    return this.page;
  }
  
  /**
   * Get current browser instance
   * @returns {Browser} Current browser instance
   */
  getBrowser() {
    return this.browser;
  }
  
  /**
   * Check if browser is launched and ready
   * @returns {boolean} True if browser is ready
   */
  isReady() {
    return !!(this.browser && this.page);
  }
}

module.exports = BrowserManager;