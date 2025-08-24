require('dotenv').config();
const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();

  // Configuration
  const consulate = process.env.VISA_CONSULATE || 'Brasília';
  const maxDate = process.env.VISA_MAX_DATE || '31-12-2025';
  const refreshInterval = parseInt(process.env.VISA_REFRESH_INTERVAL || '30') * 1000; // Convert to milliseconds

  console.log(`🚀 Starting Visa Appointment Monitor`);
  console.log(`📍 Consulate: ${consulate}`);
  console.log(`📅 Max Date: ${maxDate}`);
  console.log(`🔄 Refresh Interval: ${refreshInterval / 1000} seconds`);
  console.log(`⏰ Started at: ${new Date().toLocaleString()}`);

  // Initial login
  console.log(`\n🔐 Performing initial login...`);
  await page.goto('https://ais.usvisa-info.com/pt-br/niv/users/sign_in', { waitUntil: 'networkidle2' });

  // Fill in email
  await page.type('#user_email', process.env.VISA_USER);

  // Fill in password
  await page.type('#user_password', process.env.VISA_PASS);

  // Accept terms
  await page.click('#policy_confirmed');

  // Click login button
  await page.click('input[name="commit"]');

  console.log("➡️ Submitted login form (captcha may still block you)");

  // Wait for login to complete and navigate to appointment page
  await page.waitForNavigation({ waitUntil: 'networkidle2' });
  console.log("➡️ Login successful, navigating to appointment page...");

  await page.goto('https://ais.usvisa-info.com/pt-br/niv/schedule/70146646/appointment', { waitUntil: 'networkidle2' });
  console.log("➡️ Arrived at appointment scheduling page");

  // Select consulate location (do this once)
  console.log(`\n🏛️ Selecting consulate: ${consulate}`);

  // Wait for the consulate selection element
  await page.waitForSelector('#appointments_consulate_appointment_facility_id', { timeout: 10000 });

  // Click on the select element to focus it
  await page.click('#appointments_consulate_appointment_facility_id');
  await new Promise(resolve => setTimeout(resolve, 300));

  // Map consulate names to values (from the HTML options)
  const consulateValueMap = {
    'Brasília': '54',
    'Porto Alegre': '128',
    'Recife': '57',
    'Rio de Janeiro': '55',
    'São Paulo': '56'
  };

  const consulateValue = consulateValueMap[consulate];

  if (consulateValue) {
    // Use select method with the correct value
    await page.select('#appointments_consulate_appointment_facility_id', consulateValue);
    console.log(`✅ Successfully selected consulate: ${consulate} (value: ${consulateValue})`);
  } else {
    console.log(`❌ Consulate not found in mapping: ${consulate}`);
    await browser.close();
    return;
  }

  // Initialize variables for tracking
  let previousDates = [];
  let checkCount = 0;

  // Continuous monitoring loop
  console.log(`\n🔄 Starting continuous monitoring...`);
  console.log(`💡 Press Ctrl+C to stop monitoring\n`);

  while (true) {
    checkCount++;
    const checkTime = new Date().toLocaleString();

    console.log(`\n🔍 Check #${checkCount} - ${checkTime}`);
    console.log(`📅 Checking for available dates before: ${maxDate}`);

    try {
      // Refresh the page to get latest availability
      await page.reload({ waitUntil: 'networkidle2' });
      console.log(`🔄 Page refreshed`);

      // Re-select consulate after refresh (it gets reset)
      await page.waitForSelector('#appointments_consulate_appointment_facility_id', { timeout: 10000 });
      await page.select('#appointments_consulate_appointment_facility_id', consulateValue);

      // Wait for date picker to be enabled after consulate selection
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Click on the date input to open the calendar
      await page.click('#appointments_consulate_appointment_date');
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Navigate through calendar months to find available dates
      let availableDates = [];
      let monthsChecked = 0;
      const maxMonthsToCheck = 12; // Check up to 12 months ahead

      console.log(`📅 Navigating through calendar months...`);

      while (monthsChecked < maxMonthsToCheck && availableDates.length === 0) {
        console.log(`   Checking month ${monthsChecked + 1}...`);

        // Debug: First let's see what calendar elements are actually present
        if (monthsChecked === 0) {
          try {
            const allCalendarElements = await page.$$eval('.ui-datepicker-calendar td, .calendar td, [data-handler]', elements => {
              return elements.map(el => ({
                tagName: el.tagName,
                className: el.className,
                textContent: el.textContent?.trim(),
                dataHandler: el.getAttribute('data-handler'),
                dataEvent: el.getAttribute('data-event'),
                isDisabled: el.classList.contains('disabled') || el.classList.contains('ui-datepicker-unselectable') || el.classList.contains('ui-state-disabled')
              })).slice(0, 20); // First 20 elements
            });
            console.log(`   🔍 Calendar elements found:`, allCalendarElements);
          } catch (error) {
            console.log(`   ⚠️ Could not inspect calendar elements: ${error.message}`);
          }
        }

        // Try to find available dates by checking all calendar days
        try {
          // Get all calendar table cells
          const allDays = await page.$$eval('.ui-datepicker-calendar td', elements => {
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

          if (allDays.length > 0) {
            availableDates = allDays.map(day => ({ date: day.date, isAvailable: true, selector: 'available-calendar-days' }));
            console.log(`   ✅ Found ${allDays.length} available dates in month ${monthsChecked + 1}`);
            console.log(`   📅 Dates: ${allDays.map(d => d.date).join(', ')}`);

            // Select the earliest available date
            const earliestDate = Math.min(...allDays.map(d => parseInt(d.date)));
            console.log(`   🎯 Selecting earliest available date: ${earliestDate}`);

            try {
              // Find and click the earliest available date
              const dayElements = await page.$$('.ui-datepicker-calendar td');
              let dateSelected = false;

              for (const dayElement of dayElements) {
                const text = await dayElement.evaluate(el => el.textContent?.trim());
                const className = await dayElement.evaluate(el => el.className);

                if (text === earliestDate.toString() &&
                    !className.includes('ui-datepicker-unselectable') &&
                    !className.includes('ui-state-disabled') &&
                    !className.includes('ui-datepicker-other-month')) {

                  await dayElement.click();
                  console.log(`   ✅ Successfully selected date: ${earliestDate}`);

                  // Wait for selection to register
                  await new Promise(resolve => setTimeout(resolve, 1000));
                  dateSelected = true;
                  break;
                }
              }

              if (!dateSelected) {
                console.log(`   ⚠️ Could not find selectable element for date ${earliestDate}`);
              }

            } catch (error) {
              console.log(`   ❌ Error selecting date ${earliestDate}: ${error.message}`);
            }
          } else {
            console.log(`   ❌ No available dates found in this month`);
          }
        } catch (error) {
          console.log(`   ⚠️ Could not check calendar days: ${error.message}`);
        }

        // Alternative approach: try clicking on each day to see if it's available
        if (availableDates.length === 0) {
          console.log(`   🔍 Trying alternative approach - checking clickable days...`);
          try {
            const calendarDays = await page.$$('.ui-datepicker-calendar td');

            for (let i = 0; i < calendarDays.length; i++) {
              try {
                const dayElement = calendarDays[i];
                const isVisible = await dayElement.isIntersectingViewport();
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
                await new Promise(resolve => setTimeout(resolve, 500));

                // Check if the date input field was updated (indicating the click worked)
                const inputValue = await page.evaluate(() => {
                  return document.querySelector('#appointments_consulate_appointment_date')?.value;
                });

                if (inputValue && inputValue.includes(text)) {
                  console.log(`   ✅ Found available date: ${text} (click test successful)`);
                  availableDates.push({ date: text, isAvailable: true, selector: 'click-test' });

                  // Clear the date input for next test
                  await page.evaluate(() => {
                    document.querySelector('#appointments_consulate_appointment_date').value = '';
                  });
                }

                // Small delay between tests
                await new Promise(resolve => setTimeout(resolve, 200));

              } catch (error) {
                // Continue to next day
                console.log(`   ⚠️ Error testing day ${i}: ${error.message}`);
              }
            }
          } catch (error) {
            console.log(`   ⚠️ Alternative approach failed: ${error.message}`);
          }
        }

        // If no dates found in current month, try to navigate to next month
        if (availableDates.length === 0 && monthsChecked < maxMonthsToCheck - 1) {
          try {
            // Try common "next month" button selectors
            const nextButtonSelectors = [
              '.ui-datepicker-next',
              '.next-month',
              '.calendar-next',
              'a[data-handler="next"]',
              '.datepicker-next'
            ];

            let buttonClicked = false;
            for (const buttonSelector of nextButtonSelectors) {
              try {
                await page.click(buttonSelector);
                buttonClicked = true;
                await new Promise(resolve => setTimeout(resolve, 1000));
                break;
              } catch (error) {
                // Try next selector
              }
            }

            if (!buttonClicked) {
              console.log(`   ⚠️ Could not find next month button, stopping navigation`);
              break;
            }
          } catch (error) {
            console.log(`   ⚠️ Error navigating to next month: ${error.message}`);
            break;
          }
        }

        monthsChecked++;
      }

      if (availableDates.length > 0) {
        // Get the earliest available date
        const earliestDate = availableDates[0].date;
        const currentDates = availableDates.map(d => d.date).sort();

        // Check if this is a new date we haven't seen before
        const newDates = currentDates.filter(date => !previousDates.includes(date));

        if (newDates.length > 0) {
          console.log(`\n🎉 NEW DATES FOUND! 🎉`);
          console.log(`📅 New available dates: ${newDates.join(', ')}`);
        }

        console.log(`📅 Earliest available date: ${earliestDate}`);
        console.log(`📊 Total available dates: ${availableDates.length}`);

        // Update previous dates for next comparison
        previousDates = currentDates;
      } else {
        console.log(`❌ No available dates found`);
      }

    } catch (error) {
      console.log(`⚠️ Error during check: ${error.message}`);
    }

    // Wait for the specified interval before next check
    console.log(`⏳ Next check in ${refreshInterval / 1000} seconds...`);
    await new Promise(resolve => setTimeout(resolve, refreshInterval));
  }
})();

