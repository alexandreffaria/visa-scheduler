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
    this.existingAppointments = null; // Store existing appointments if found
    this.baselineDate = null; // Permanent baseline from existing appointment
    this.maxDate = config.get('maxDate'); // Store the max date from config
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
      const earliestAvailable = availableDates.reduce((earliest, current) => {
        const currentComparable = this._dateToComparable(current.fullDate);
        const earliestComparable = this._dateToComparable(earliest.fullDate);
        return currentComparable < earliestComparable ? current : earliest;
      });
      
      const dateSelected = await this.calendar.selectDate(earliestAvailable.date);
      
      if (!dateSelected) {
        console.log(`❌ Could not select consulate date: ${earliestAvailable.fullDate}`);
        return null;
      }
      
      this.selectedConsulateDate = parseInt(earliestAvailable.date);
      const selectedFullDate = earliestAvailable.fullDate;

      const isImprovementEarly = this._checkDateImprovement(selectedFullDate);
      if (!isImprovementEarly) {
        const referenceDate = this.baselineDate || this.bestDateFound;
        console.log(`   ⏭️ Found earliest available date ${selectedFullDate} is not better than reference ${referenceDate}. Skipping selection/booking.`);
        return {
          consulate: { date: selectedFullDate, time: null, location: this.config.get('consulate') },
          casv: { date: null, time: null, location: this._getCasvLocationName(this.config.get('consulate')) },
          isImprovement: false,
          previousBest: this.bestDateFound,
          baseline: this.baselineDate || null
        };
}
      
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
      
      // Check if this is a better date than previously found or existing appointments
      const isImprovement = this._checkDateImprovement(selectedFullDate);
      
      return {
        consulate: {
          date: selectedFullDate,
          time: consulateTimeResult.text,
          location: this.config.get('consulate')
        },
        casv: {
          date: casvResult.fullDate,
          time: casvResult.time,
          location: this._getCasvLocationName()
        },
        isImprovement,
        previousBest: this.bestDateFound,
        existingAppointments: this.existingAppointments
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
      
      // Get the consulate month and year to limit CASV search
      // Extract from the fullDate that was already selected
      let consulateMonth = null;
      let consulateYear = null;
      
      // For CASV, we only need to check the current month and possibly previous month
      // Get the month/year from the current calendar context
      if (this.calendar.currentMonth && this.calendar.currentYear) {
        consulateMonth = this.calendar.currentMonth;
        consulateYear = this.calendar.currentYear;
        console.log(`   ℹ️ Using consulate month/year as boundary: ${consulateMonth}/${consulateYear}`);
      }
      
      // Open CASV calendar
      await this.calendar.openCalendar('casv');
      
      // Find available CASV dates, passing the consulate date to optimize search
      // Also pass month/year to stop searching past consulate date
      const availableCasvDates = await this.calendar.findAvailableDates(
        'casv',
        this.selectedConsulateDate,
        consulateMonth,
        consulateYear
      );
      
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
        fullDate: bestMatch.fullDate,
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
    
    // First, compare with the maxDate from config
    const maxDateComparable = this._dateToComparable(this.maxDate);
    
    // If the new date is later than the max date, it's not an improvement
    if (newComparable > maxDateComparable) {
      console.log(`   ⚠️ Found date ${newDate} is later than max date: ${this.maxDate} - not acceptable`);
      return false;
    }
    
    // If we have a baseline date (existing appointment), always compare against it
    // otherwise use maxDate or bestDateFound
    const comparisonDate = this.baselineDate || this.bestDateFound || this.maxDate;
    
    if (!this.baselineDate && !this.bestDateFound) {
      // First date found and no existing appointments
      // Only accept if it's earlier than max date (already checked above)
      this.bestDateFound = newDate;
      console.log(`   📈 First date found: ${newDate} (earlier than max date: ${this.maxDate})`);
      return true;
    }
    
    const baselineComparable = this._dateToComparable(comparisonDate);
    const isImprovement = newComparable < baselineComparable;
    
    if (isImprovement) {
      const previousBest = this.bestDateFound;
      this.bestDateFound = newDate;
      
      if (this.baselineDate) {
        console.log(`   📈 Found date ${newDate} is better than baseline appointment: ${this.baselineDate}`);
      } else {
        console.log(`   📈 New best date: ${newDate} (improved from ${previousBest || this.maxDate})`);
      }
    } else {
      const referenceDate = this.baselineDate || this.bestDateFound || this.maxDate;
      if (this.baselineDate) {
        console.log(`   📅 Found date ${newDate} is not better than baseline appointment: ${referenceDate} - no notification will be sent`);
      } else {
        console.log(`   📅 Found date ${newDate} is not better than current best: ${referenceDate}`);
      }
    }
    
    // Only update best date if it's an improvement
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
      throw new Error(`Invalid date format: ${dateStr}. Expected DD-MM-YYYY format.`);
    }
  }
  
  /**
   * Format date for display
   * @private
   * @param {string|number} dateStr - Date to format
   * @returns {string} Formatted date string
   */
  /**
   * Set existing appointments if found
   * @param {object} appointments - Existing appointment information
   */
  setExistingAppointments(appointments) {
    this.existingAppointments = appointments;
    // Set the existing appointment as the permanent baseline that never changes
    this.baselineDate = appointments.consulate.date;
    this.bestDateFound = appointments.consulate.date;
    console.log(`📅 Existing appointment set as permanent baseline: ${appointments.consulate.date}`);
    console.log(`📅 Will only notify for dates better than: ${this.baselineDate}`);
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
   * Get the baseline date (existing appointment)
   * @returns {string|null} Baseline date found at startup
   */
  getBaselineDate() {
    return this.baselineDate;
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