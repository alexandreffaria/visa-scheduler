/**
 * Calendar navigation utilities for finding and selecting appointment dates
 */
class CalendarNavigator {
  constructor(config, browserManager) {
    this.config = config;
    this.browser = browserManager;
  }
  
  /**
   * Find available dates in the calendar
   * @param {string} calendarType - Type of calendar ('consulate' or 'casv')
   * @returns {Promise<Array>} Array of available dates
   */
  async findAvailableDates(calendarType = 'consulate') {
    console.log(`📅 Navigating through ${calendarType} calendar months...`);
    
    let availableDates = [];
    let monthsChecked = 0;
    const maxMonthsToCheck = calendarType === 'casv' ? 
      this.config.get('monitoring.maxCasvMonthsToCheck') : 
      this.config.get('monitoring.maxMonthsToCheck');
    
    while (monthsChecked < maxMonthsToCheck && availableDates.length === 0) {
      console.log(`   Checking ${calendarType} month ${monthsChecked + 1}...`);
      
      // Debug calendar elements on first month
      if (monthsChecked === 0) {
        await this._debugCalendarElements();
      }
      
      // Try to find available dates using different methods
      availableDates = await this._findDatesInCurrentMonth();
      
      if (availableDates.length > 0) {
        console.log(`   ✅ Found ${availableDates.length} available dates in month ${monthsChecked + 1}`);
        console.log(`   📅 Dates: ${availableDates.map(d => d.date).join(', ')}`);
        break;
      }
      
      console.log(`   ❌ No available dates found in this month`);
      
      // Navigate to next month if no dates found
      if (monthsChecked < maxMonthsToCheck - 1) {
        const navigated = await this._navigateToNextMonth();
        if (!navigated) {
          console.log(`   ⚠️ Could not navigate to next month, stopping search`);
          break;
        }
      }
      
      monthsChecked++;
    }
    
    return availableDates;
  }
  
  /**
   * Find available dates in the current month
   * @private
   * @returns {Promise<Array>} Array of available dates
   */
  async _findDatesInCurrentMonth() {
    let availableDates = [];
    
    try {
      // Method 1: Check all calendar table cells
      availableDates = await this._findDatesByTableCells();
      
      if (availableDates.length === 0) {
        // Method 2: Alternative approach - check clickable days
        console.log(`   🔍 Trying alternative approach - checking clickable days...`);
        availableDates = await this._findDatesByClickTest();
      }
      
    } catch (error) {
      console.log(`   ⚠️ Error finding dates in current month: ${error.message}`);
    }
    
    return availableDates;
  }
  
  /**
   * Find dates by analyzing table cells
   * @private
   * @returns {Promise<Array>} Array of available dates
   */
  async _findDatesByTableCells() {
    try {
      const availableDates = await this.browser.getElementsInfo('.ui-datepicker-calendar td', elements => {
        return elements.map(el => {
          const date = el.textContent?.trim();
          const className = el.className;
          const isDisabled = el.classList.contains('ui-datepicker-unselectable') ||
                           el.classList.contains('ui-state-disabled') ||
                           el.classList.contains('disabled');
          const isOtherMonth = el.classList.contains('ui-datepicker-other-month');

          return {
            date,
            className,
            isDisabled,
            isOtherMonth,
            isAvailable: !isDisabled && !isOtherMonth && date
          };
        }).filter(day => day.isAvailable && day.date && !isNaN(parseInt(day.date)));
      });
      
      return availableDates.map(day => ({ 
        date: day.date, 
        isAvailable: true, 
        method: 'table-cells' 
      }));
      
    } catch (error) {
      console.log(`   ⚠️ Could not check calendar table cells: ${error.message}`);
      return [];
    }
  }
  
  /**
   * Find dates by testing clicks on each day
   * @private
   * @returns {Promise<Array>} Array of available dates
   */
  async _findDatesByClickTest() {
    const availableDates = [];
    
    try {
      const calendarDays = await this.browser.findElements('.ui-datepicker-calendar td');
      
      for (let i = 0; i < calendarDays.length; i++) {
        try {
          const dayElement = calendarDays[i];
          const className = await dayElement.evaluate(el => el.className);
          const text = await dayElement.evaluate(el => el.textContent?.trim());

          // Skip if it's not a valid date or is disabled
          if (!text || isNaN(parseInt(text)) ||
              className.includes('ui-datepicker-unselectable') ||
              className.includes('ui-state-disabled') ||
              className.includes('ui-datepicker-other-month')) {
            continue;
          }

          // Try to click the day to see if it's available
          await dayElement.click();
          await this.browser.wait(500);

          // Check if the date input field was updated (indicating the click worked)
          const inputValue = await this.browser.evaluate(() => {
            const consularInput = document.querySelector('#appointments_consulate_appointment_date');
            const casvInput = document.querySelector('#appointments_asc_appointment_date');
            return consularInput?.value || casvInput?.value;
          });

          if (inputValue && inputValue.includes(text)) {
            console.log(`   ✅ Found available date: ${text} (click test successful)`);
            availableDates.push({ date: text, isAvailable: true, method: 'click-test' });

            // Clear the date input for next test
            await this.browser.evaluate(() => {
              const consularInput = document.querySelector('#appointments_consulate_appointment_date');
              const casvInput = document.querySelector('#appointments_asc_appointment_date');
              if (consularInput) consularInput.value = '';
              if (casvInput) casvInput.value = '';
            });
          }

          // Small delay between tests
          await this.browser.wait(200);

        } catch (error) {
          // Continue to next day
          console.log(`   ⚠️ Error testing day ${i}: ${error.message}`);
        }
      }
    } catch (error) {
      console.log(`   ⚠️ Alternative approach failed: ${error.message}`);
    }
    
    return availableDates;
  }
  
  /**
   * Navigate to the next month in the calendar
   * @private
   * @returns {Promise<boolean>} True if navigation was successful
   */
  async _navigateToNextMonth() {
    const nextButtonSelectors = [
      '.ui-datepicker-next',
      '.next-month',
      '.calendar-next',
      'a[data-handler="next"]',
      '.datepicker-next'
    ];

    for (const buttonSelector of nextButtonSelectors) {
      try {
        await this.browser.click(buttonSelector);
        await this.browser.wait(1000); // Wait for calendar to update
        return true;
      } catch (error) {
        // Try next selector
        continue;
      }
    }

    return false;
  }
  
  /**
   * Debug calendar elements to understand the structure
   * @private
   */
  async _debugCalendarElements() {
    try {
      const calendarElements = await this.browser.getElementsInfo(
        '.ui-datepicker-calendar td, .calendar td, [data-handler]', 
        elements => {
          return elements.map(el => ({
            tagName: el.tagName,
            className: el.className,
            textContent: el.textContent?.trim(),
            dataHandler: el.getAttribute('data-handler'),
            dataEvent: el.getAttribute('data-event'),
            isDisabled: el.classList.contains('disabled') || 
                       el.classList.contains('ui-datepicker-unselectable') || 
                       el.classList.contains('ui-state-disabled')
          })).slice(0, 20); // First 20 elements
        }
      );
      console.log(`   🔍 Calendar elements found:`, calendarElements);
    } catch (error) {
      console.log(`   ⚠️ Could not inspect calendar elements: ${error.message}`);
    }
  }
  
  /**
   * Select a specific date from the calendar
   * @param {string} dateToSelect - Date to select (day number)
   * @returns {Promise<boolean>} True if date was selected successfully
   */
  async selectDate(dateToSelect) {
    console.log(`   🎯 Selecting date: ${dateToSelect}`);
    
    try {
      const dayElements = await this.browser.findElements('.ui-datepicker-calendar td');
      
      for (const dayElement of dayElements) {
        const text = await dayElement.evaluate(el => el.textContent?.trim());
        const className = await dayElement.evaluate(el => el.className);

        if (text === dateToSelect.toString() &&
            !className.includes('ui-datepicker-unselectable') &&
            !className.includes('ui-state-disabled') &&
            !className.includes('ui-datepicker-other-month')) {

          await dayElement.click();
          console.log(`   ✅ Successfully selected date: ${dateToSelect}`);
          
          // Wait for selection to register
          await this.browser.wait(this.config.get('monitoring.selectionDelay'));
          return true;
        }
      }
      
      console.log(`   ⚠️ Could not find selectable element for date ${dateToSelect}`);
      return false;
      
    } catch (error) {
      console.log(`   ❌ Error selecting date ${dateToSelect}: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Find CASV dates that match the consulate date within tolerance
   * @param {number} consulateDate - The consulate date to match
   * @param {Array} availableCasvDates - Available CASV dates
   * @returns {Array} Matching CASV dates
   */
  findMatchingCasvDates(consulateDate, availableCasvDates) {
    const tolerance = this.config.get('monitoring.casvDateTolerance');
    
    const matchingDates = availableCasvDates.filter(day => {
      const casvDate = parseInt(day.date);
      const difference = Math.abs(casvDate - consulateDate);
      return difference <= tolerance;
    });
    
    if (matchingDates.length > 0) {
      console.log(`   🎯 Found ${matchingDates.length} matching CASV dates: ${matchingDates.map(d => d.date).join(', ')}`);
    } else {
      console.log(`   ❌ No CASV dates found within ±${tolerance} days of consulate date ${consulateDate}`);
      console.log(`   🔍 Looking for dates between ${Math.max(1, consulateDate - tolerance)} and ${consulateDate + tolerance}`);
    }
    
    return matchingDates;
  }
  
  /**
   * Get the best matching CASV date (closest to consulate date)
   * @param {number} consulateDate - The consulate date to match
   * @param {Array} matchingDates - Array of matching CASV dates
   * @returns {object} Best matching date
   */
  getBestMatchingCasvDate(consulateDate, matchingDates) {
    if (matchingDates.length === 0) {
      return null;
    }
    
    // Find the date closest to the consulate date
    let bestMatch = matchingDates[0];
    let bestDifference = Math.abs(parseInt(bestMatch.date) - consulateDate);

    for (const casvDay of matchingDates) {
      const difference = Math.abs(parseInt(casvDay.date) - consulateDate);
      if (difference < bestDifference) {
        bestMatch = casvDay;
        bestDifference = difference;
      }
    }
    
    console.log(`   ✅ Best matching CASV date: ${bestMatch.date} (difference: ${bestDifference} days)`);
    return bestMatch;
  }
  
  /**
   * Open a calendar by clicking on its date input
   * @param {string} calendarType - Type of calendar ('consulate' or 'casv')
   */
  async openCalendar(calendarType) {
    const selector = calendarType === 'casv' ? 
      '#appointments_asc_appointment_date' : 
      '#appointments_consulate_appointment_date';
    
    console.log(`📅 Opening ${calendarType} calendar...`);
    await this.browser.click(selector);
    await this.browser.wait(this.config.get('monitoring.calendarDelay'));
  }
}

module.exports = CalendarNavigator;