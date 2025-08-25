/**
 * Authentication handler for visa appointment system
 */
class AuthHandler {
  constructor(config, browserManager) {
    this.config = config;
    this.browser = browserManager;
  }
  
  /**
   * Perform login with retry logic
   * @returns {Promise<void>}
   */
  async login() {
    console.log(`\n🔐 Performing initial login...`);
    
    let loginSuccess = false;
    let attempts = 0;
    const maxAttempts = 3;
    
    while (!loginSuccess && attempts < maxAttempts) {
      attempts++;
      console.log(`🔄 Login attempt ${attempts}/${maxAttempts}`);
      
      try {
        await this._performLoginAttempt();
        loginSuccess = true;
        console.log(`✅ Login successful!`);
        
      } catch (error) {
        console.log(`⚠️ Login attempt ${attempts} failed: ${error.message}`);
        
        if (attempts < maxAttempts) {
          const retryDelay = this.config.get('refreshInterval');
          console.log(`🔄 Will retry in ${retryDelay / 1000} seconds...`);
          await this.browser.wait(retryDelay);
        } else {
          throw new Error(`Login failed after ${maxAttempts} attempts: ${error.message}`);
        }
      }
    }
  }
  
  /**
   * Perform a single login attempt
   * @private
   */
  async _performLoginAttempt() {
    // Navigate to login page
    console.log(`🔗 Navigating to login page...`);
    await this.browser.navigateTo(this.config.get('urls.login'));
    
    // Fill in credentials
    await this._fillCredentials();
    
    // Accept terms
    await this._acceptTerms();
    
    // Submit login form
    await this._submitLogin();
    
    // Wait for login to complete
    await this._waitForLoginCompletion();
    
    // Navigate to appointment page
    await this._navigateToAppointmentPage();
  }
  
  /**
   * Fill in email and password
   * @private
   */
  async _fillCredentials() {
    const user = this.config.get('user');
    const password = this.config.get('password');
    
    if (!user || !password) {
      throw new Error('Missing login credentials');
    }
    
    console.log(`📝 Filling in credentials for: ${user}`);
    
    // Fill in email
    await this.browser.typeText('#user_email', user);
    
    // Fill in password
    await this.browser.typeText('#user_password', password);
  }
  
  /**
   * Accept terms and conditions
   * @private
   */
  async _acceptTerms() {
    console.log(`✅ Accepting terms and conditions...`);
    await this.browser.click('#policy_confirmed');
  }
  
  /**
   * Submit the login form
   * @private
   */
  async _submitLogin() {
    console.log(`🚀 Submitting login form...`);
    await this.browser.click('input[name="commit"]');
    console.log(`➡️ Submitted login form (captcha may still block you)`);
  }
  
  /**
   * Wait for login completion and navigation
   * @private
   */
  async _waitForLoginCompletion() {
    console.log(`⏳ Waiting for login completion...`);
    
    try {
      // Wait for navigation after login - this indicates successful login
      await this.browser.getPage().waitForNavigation({ 
        waitUntil: 'networkidle2', 
        timeout: this.config.get('monitoring.pageLoadTimeout')
      });
      console.log(`➡️ Login navigation completed`);
    } catch (error) {
      // Check if we're still on the login page (indicating failed login)
      const currentUrl = this.browser.getPage().url();
      if (currentUrl.includes('sign_in')) {
        throw new Error('Login failed - still on login page (possible captcha or invalid credentials)');
      }
      throw error;
    }
  }
  
  /**
   * Navigate to the appointment scheduling page
   * @private
   */
  async _navigateToAppointmentPage() {
    console.log(`🔗 Navigating to appointment page...`);
    await this.browser.navigateTo(this.config.get('urls.appointment'));
    console.log(`➡️ Arrived at appointment scheduling page`);
  }
  
  /**
   * Check if user is currently logged in
   * @returns {Promise<boolean>}
   */
  async isLoggedIn() {
    try {
      const currentUrl = this.browser.getPage().url();
      
      // If we're on the login page, we're not logged in
      if (currentUrl.includes('sign_in')) {
        return false;
      }
      
      // Try to find elements that only exist when logged in
      try {
        await this.browser.waitForSelector('.user-info-footer', 2000);
        return true;
      } catch (error) {
        return false;
      }
    } catch (error) {
      console.log(`⚠️ Error checking login status: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Get current user information from the page
   * @returns {Promise<object>} User information
   */
  async getUserInfo() {
    try {
      const userInfoText = await this.browser.getElementInfo('.user-info-footer strong');
      return {
        accountInfo: userInfoText || 'Unknown user'
      };
    } catch (error) {
      console.log(`⚠️ Could not retrieve user info: ${error.message}`);
      return {
        accountInfo: 'User info not available'
      };
    }
  }
  
  /**
   * Handle session expiration and re-login
   * @returns {Promise<void>}
   */
  async handleSessionExpiration() {
    console.log(`🔄 Session may have expired, attempting re-login...`);
    
    try {
      // Check if we're redirected to login page
      const currentUrl = this.browser.getPage().url();
      if (currentUrl.includes('sign_in')) {
        console.log(`🔐 Redirected to login page, performing re-authentication...`);
        await this.login();
      } else {
        console.log(`✅ Session still valid, no re-login needed`);
      }
    } catch (error) {
      console.log(`❌ Re-authentication failed: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Logout from the system
   * @returns {Promise<void>}
   */
  async logout() {
    try {
      console.log(`🚪 Logging out...`);
      
      // Look for logout link
      const logoutSelectors = [
        'a[href*="sign_out"]',
        'a:contains("Sair")',
        'a:contains("Logout")'
      ];
      
      for (const selector of logoutSelectors) {
        try {
          await this.browser.click(selector);
          console.log(`✅ Logout successful`);
          return;
        } catch (error) {
          // Try next selector
          continue;
        }
      }
      
      console.log(`⚠️ Could not find logout link`);
    } catch (error) {
      console.log(`⚠️ Logout failed: ${error.message}`);
    }
  }
}

module.exports = AuthHandler;