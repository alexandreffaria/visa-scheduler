/**
 * Appointment booking logic for consulate and CASV appointments
 */
class AppointmentBooker {
  constructor(config, browserManager, calendarNavigator) {
    this.config = config;
    this.browser = browserManager;
    this.calendar = calendarNavigator;
    this.bestDateFound = null;
    this.selectedConsulateDate = null;
    this.currentMonth = new Date().getMonth() + 1;
    this.currentYear = new Date().getFullYear();
  }
  
  /**
   * Set up the consulate selection (one-time setup)
   * @returns {Promise<void>}
   */
  async setupConsulateSelection() {
    const consulate = this.config.get('consulate');
    const consulateValue = this.config.getConsulateValue();
    
    console.log(`\n🏛️ Selecting consulate: ${consulate}`);
    
    // Wait for the consulate selection element
    await this.browser.waitForSelector('#appointments_consulate_appointment_facility_id');
    
    // Click on the select element to focus it
    await this.browser.click('#appointments_consulate_appointment_facility_id');
    await this.browser.wait(300);
    
    // Select the consulate
    await this.browser.select('#appointments_consulate_appointment_facility_id', consulateValue);
    console.log(`✅ Successfully selected consulate: ${consulate} (value: ${consulateValue})`);
  }
  
  /**
   * Attempt to book an appointment
   * @returns {Promise<object|null>} Booking result or null if no appointment available
   */
  async attemptBooking() {
    try {
      // Re-select consulate after page refresh (it gets reset)
      await this._reselectConsulate();
      
      // Wait for date picker to be enabled after consulate selection
      await this.browser.wait(3000);
      
      // Open consulate calendar
      await this.calendar.openCalendar('consulate');
      
      // Find available consulate dates
      const availableDates = await this.calendar.findAvailableDates('consulate');
      
      if (availableDates.length === 0) {
        console.log(`❌ No available consulate dates found`);
        return null;
      }
      
      // Select the earliest available date
      const earliestDate = Math.min(...availableDates.map(d => parseInt(d.date)));
      const dateSelected = await this.calendar.selectDate(earliestDate);
      
      if (!dateSelected) {
        console.log(`❌ Could not select consulate date: ${earliestDate}`);
        return null;
      }
      
      this.selectedConsulateDate = parseInt(earliestDate);
      
      // Select consulate time slot
      const consulateTimeResult = await this._selectConsulateTime();
      if (!consulateTimeResult) {
        console.log(`❌ Could not select consulate time slot`);
        return null;
      }
      
      // Select CASV location and appointment
      const casvResult = await this._selectCasvAppointment();
      if (!casvResult) {
        console.log(`❌ Could not select CASV appointment`);
        return null;
      }
      
      // Check if this is a better date than previously found
      const isImprovement = this._checkDateImprovement(earliestDate);
      
      return {
        consulate: {
          date: this._formatFullDate(earliestDate),
          time: consulateTimeResult.text,
          location: this.config.get('consulate')
        },
        casv: {
          date: this._formatFullDate(casvResult.date),
          time: casvResult.time,
          location: this._getCasvLocationName()
        },
        isImprovement,
        previousBest: this.bestDateFound
      };
      
    } catch (error) {
      console.log(`⚠️ Error during appointment booking: ${error.message}`);
      return null;
    }
  }
  
  /**
   * Re-select consulate after page refresh
   * @private
   */
  async _reselectConsulate() {
    const consulateValue = this.config.getConsulateValue();
    
    await this.browser.waitForSelector('#appointments_consulate_appointment_facility_id');
    await this.browser.select('#appointments_consulate_appointment_facility_id', consulateValue);
  }
  
  /**
   * Select the latest available consulate time slot
   * @private
   * @returns {Promise<object|null>} Selected time information
   */
  async _selectConsulateTime() {
    try {
      console.log(`   ⏰ Looking for available time slots...`);
      
      // Wait for time options to load
      await this.browser.waitForSelector('#appointments_consulate_appointment_time option');
      
      // Get all available time options
      const timeOptions = await this.browser.getElementsInfo('#appointments_consulate_appointment_time option', options => {
        return options.map(option => ({
          value: option.value,
          text: option.text.trim(),
          disabled: option.disabled
        })).filter(option => option.value && !option.disabled && option.text);
      });
      
      if (timeOptions.length === 0) {
        console.log(`   ❌ No time slots available for selected date`);
        return null;
      }
      
      // Select the last (latest) time slot
      const latestTime = timeOptions[timeOptions.length - 1];
      console.log(`   📅 Available times: ${timeOptions.map(t => t.text).join(', ')}`);
      console.log(`   🎯 Selecting latest time: ${latestTime.text}`);
      
      await this.browser.select('#appointments_consulate_appointment_time', latestTime.value);
      console.log(`   ✅ Successfully selected time: ${latestTime.text}`);
      
      // Wait for time selection to register
      await this.browser.wait(this.config.get('monitoring.actionDelay'));
      
      return latestTime;
      
    } catch (error) {
      console.log(`   ⚠️ Could not select time slot: ${error.message}`);
      return null;
    }
  }
  
  /**
   * Select CASV location and appointment
   * @private
   * @returns {Promise<object|null>} CASV appointment information
   */
  async _selectCasvAppointment() {
    try {
      console.log(`   🏢 Selecting corresponding CASV location...`);
      
      const casvValue = this.config.getCasvValue();
      const consulate = this.config.get('consulate');
      
      // Wait for CASV selection to be available
      await this.browser.waitForSelector('#appointments_asc_appointment_facility_id');
      await this.browser.select('#appointments_asc_appointment_facility_id', casvValue);
      console.log(`   ✅ Successfully selected CASV location: ${casvValue} for ${consulate}`);
      
      // Wait for CASV selection to register
      await this.browser.wait(this.config.get('monitoring.actionDelay'));
      
      // Find and select matching CASV date
      return await this._selectMatchingCasvDate();
      
    } catch (error) {
      console.log(`   ⚠️ Could not select CASV location: ${error.message}`);
      return null;
    }
  }
  
  /**
   * Find and select matching CASV date
   * @private
   * @returns {Promise<object|null>} Selected CASV appointment
   */
  async _selectMatchingCasvDate() {
    try {
      console.log(`   📅 Checking CASV dates near consulate date ${this.selectedConsulateDate}...`);
      
      // Open CASV calendar
      await this.calendar.openCalendar('casv');
      
      // Find available CASV dates
      const availableCasvDates = await this.calendar.findAvailableDates('casv');
      
      if (availableCasvDates.length === 0) {
        console.log(`   ❌ No CASV dates found`);
        return null;
      }
      
      // Find matching dates within tolerance
      const matchingDates = this.calendar.findMatchingCasvDates(
        this.selectedConsulateDate,
        availableCasvDates
      );
      
      if (matchingDates.length === 0) {
        console.log(`   ❌ No CASV dates found within tolerance of consulate date`);
        console.log(`   📅 Available CASV dates: ${availableCasvDates.map(d => d.date).join(', ')}`);
        return null;
      }
      
      // Get the best matching date
      const bestMatch = this.calendar.getBestMatchingCasvDate(
        this.selectedConsulateDate,
        matchingDates
      );
      
      // Select the best matching CASV date
      const dateSelected = await this.calendar.selectDate(bestMatch.date);
      if (!dateSelected) {
        console.log(`   ❌ Could not select CASV date: ${bestMatch.date}`);
        return null;
      }
      
      // Wait for CASV date selection to register
      await this.browser.wait(this.config.get('monitoring.actionDelay'));
      
      // Select CASV time slot
      const casvTimeResult = await this._selectCasvTime();
      if (!casvTimeResult) {
        console.log(`   ❌ Could not select CASV time slot`);
        return null;
      }
      
      return {
        date: bestMatch.date,
        time: casvTimeResult.text
      };
      
    } catch (error) {
      console.log(`   ⚠️ Could not check CASV dates: ${error.message}`);
      return null;
    }
  }
  
  /**
   * Select the earliest available CASV time slot
   * @private
   * @returns {Promise<object|null>} Selected CASV time information
   */
  async _selectCasvTime() {
    try {
      console.log(`   ⏰ Looking for available CASV time slots...`);
      
      // Wait for CASV time options to load
      await this.browser.waitForSelector('#appointments_asc_appointment_time option');
      
      // Get all available CASV time options
      const timeOptions = await this.browser.getElementsInfo('#appointments_asc_appointment_time option', options => {
        return options.map(option => ({
          value: option.value,
          text: option.text.trim(),
          disabled: option.disabled
        })).filter(option => option.value && !option.disabled && option.text);
      });
      
      if (timeOptions.length === 0) {
        console.log(`   ❌ No CASV time slots available for selected date`);
        return null;
      }
      
      // Select the first (earliest) CASV time slot
      const earliestTime = timeOptions[0];
      console.log(`   📅 Available CASV times: ${timeOptions.map(t => t.text).join(', ')}`);
      console.log(`   🎯 Selecting earliest CASV time: ${earliestTime.text}`);
      
      await this.browser.select('#appointments_asc_appointment_time', earliestTime.value);
      console.log(`   ✅ Successfully selected CASV time: ${earliestTime.text}`);
      
      // Wait for CASV time selection to register
      await this.browser.wait(this.config.get('monitoring.actionDelay'));
      
      return earliestTime;
      
    } catch (error) {
      console.log(`   ⚠️ Could not select CASV time slot: ${error.message}`);
      return null;
    }
  }
  
  /**
   * Check if the new date is better than the previously found best date
   * @private
   * @param {string|number} newDate - New date to check
   * @returns {boolean} True if this is a better date
   */
  _checkDateImprovement(newDate) {
    const newComparable = this._dateToComparable(newDate);
    
    if (!this.bestDateFound) {
      this.bestDateFound = this._formatFullDate(newDate);
      return true; // First date found
    }
    
    const bestComparable = this._dateToComparable(this.bestDateFound);
    const isImprovement = newComparable < bestComparable;
    
    if (isImprovement) {
      this.bestDateFound = this._formatFullDate(newDate);
    }
    
    return isImprovement;
  }
  
  /**
   * Convert date to comparable format (YYYYMMDD)
   * @private
   * @param {string|number} dateStr - Date to convert
   * @returns {number} Comparable date number
   */
  _dateToComparable(dateStr) {
    if (typeof dateStr === 'string' && dateStr.includes('-')) {
      const [day, month, year] = dateStr.split('-').map(Number);
      return year * 10000 + month * 100 + day;
    } else {
      // Day number only - use current month/year context
      const day = parseInt(dateStr);
      return this.currentYear * 10000 + this.currentMonth * 100 + day;
    }
  }
  
  /**
   * Format date for display
   * @private
   * @param {string|number} dateStr - Date to format
   * @returns {string} Formatted date string
   */
  _formatFullDate(dateStr) {
    if (typeof dateStr === 'string' && dateStr.includes('-')) {
      return dateStr; // Already in full format
    } else {
      // Day number only - format with current month/year
      const day = parseInt(dateStr);
      return `${day.toString().padStart(2, '0')}-${this.currentMonth.toString().padStart(2, '0')}-${this.currentYear}`;
    }
  }
  
  /**
   * Get the CASV location name for display
   * @private
   * @returns {string} CASV location name
   */
  _getCasvLocationName() {
    const consulate = this.config.get('consulate');
    const locationMap = {
      'Brasília': 'Brasília ASC',
      'Porto Alegre': 'Brasília ASC',
      'Recife': 'Brasília ASC',
      'Rio de Janeiro': 'Rio de Janeiro ASC',
      'São Paulo': 'São Paulo ASC Unidade Vila Mariana'
    };
    
    return locationMap[consulate] || 'Unknown ASC';
  }
  
  /**
   * Print booking success message
   * @param {object} booking - Booking information
   */
  printBookingSuccess(booking) {
    console.log(`\n🎉 APPOINTMENT SUCCESSFULLY SELECTED! 🎉`);
    console.log(`📅 Consulate Date: ${booking.consulate.date}`);
    console.log(`⏰ Consulate Time: ${booking.consulate.time}`);
    console.log(`🏢 CASV Date: ${booking.casv.date}`);
    console.log(`⏰ CASV Time: ${booking.casv.time}`);
    
    if (booking.isImprovement) {
      console.log(`\n🏆 NEW BEST DATE FOUND! 🏆`);
      if (booking.previousBest) {
        console.log(`📈 Previous best: ${booking.previousBest}`);
      }
      console.log(`🎯 New best: ${booking.consulate.date}`);
    }
  }
  
  /**
   * Get current best date found
   * @returns {string|null} Best date found so far
   */
  getBestDateFound() {
    return this.bestDateFound;
  }
  
  /**
   * Reset the booking state
   */
  reset() {
    this.selectedConsulateDate = null;
    // Note: We keep bestDateFound to track improvements across sessions
  }
}

module.exports = AppointmentBooker;