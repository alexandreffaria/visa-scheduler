require('dotenv').config();
const puppeteer = require('puppeteer');
const TelegramBot = require('node-telegram-bot-api');

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

  // Initialize Telegram Bot
  let telegramBot = null;
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    telegramBot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });
    console.log(`📱 Telegram notifications enabled`);
  } else {
    console.log(`📱 Telegram notifications disabled (missing bot token or chat ID)`);
  }

  // Function to send Telegram notification
  async function sendTelegramNotification(message) {
    if (telegramBot && process.env.TELEGRAM_CHAT_ID) {
      try {
        await telegramBot.sendMessage(process.env.TELEGRAM_CHAT_ID, message, { parse_mode: 'HTML' });
        console.log(`📱 Telegram notification sent successfully`);
      } catch (error) {
        console.log(`⚠️ Failed to send Telegram notification: ${error.message}`);
      }
    }
  }

  // Function to compare dates and check if new date is better
  function isBetterDate(newDateStr, currentBest) {
    if (!currentBest) return true; // First date found

    // Convert to comparable format (YYYYMMDD)
    function dateToComparable(dateStr) {
      if (typeof dateStr === 'string' && dateStr.includes('-')) {
        const [day, month, year] = dateStr.split('-').map(Number);
        return year * 10000 + month * 100 + day;
      } else {
        // Day number only - use current month/year context
        const day = parseInt(dateStr);
        return currentYear * 10000 + currentMonth * 100 + day;
      }
    }

    const newComparable = dateToComparable(newDateStr);
    const bestComparable = dateToComparable(currentBest);

    return newComparable < bestComparable;
  }

  // Function to format date for display
  function formatFullDate(dateStr) {
    if (typeof dateStr === 'string' && dateStr.includes('-')) {
      return dateStr; // Already in full format
    } else {
      // Day number only - format with current month/year
      const day = parseInt(dateStr);
      return `${day.toString().padStart(2, '0')}-${currentMonth.toString().padStart(2, '0')}-${currentYear}`;
    }
  }

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
  let selectedConsulateDate = null; // Track the selected consulate date
  let bestDateFound = null; // Track the best (earliest) date found so far
  let currentMonth = new Date().getMonth() + 1; // Current month being checked
  let currentYear = new Date().getFullYear(); // Current year being checked

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

                  // Store the selected consulate date for CASV matching
                  selectedConsulateDate = parseInt(earliestDate);

                  // Wait for selection to register
                  await new Promise(resolve => setTimeout(resolve, 2000));
                  dateSelected = true;

                  // Select the latest available time slot
                  try {
                    console.log(`   ⏰ Looking for available time slots...`);

                    // Wait for time options to load
                    await page.waitForSelector('#appointments_consulate_appointment_time option', { timeout: 10000 });

                    // Get all available time options
                    const timeOptions = await page.$$eval('#appointments_consulate_appointment_time option', options => {
                      return options.map(option => ({
                        value: option.value,
                        text: option.text.trim(),
                        disabled: option.disabled
                      })).filter(option => option.value && !option.disabled && option.text);
                    });

                    if (timeOptions.length > 0) {
                      // Select the last (latest) time slot
                      const latestTime = timeOptions[timeOptions.length - 1];
                      console.log(`   📅 Available times: ${timeOptions.map(t => t.text).join(', ')}`);
                      console.log(`   🎯 Selecting latest time: ${latestTime.text}`);

                      await page.select('#appointments_consulate_appointment_time', latestTime.value);
                      console.log(`   ✅ Successfully selected time: ${latestTime.text}`);

                      // Wait for time selection to register
                      await new Promise(resolve => setTimeout(resolve, 1000));

                      // Select corresponding CASV location
                      try {
                        console.log(`   🏢 Selecting corresponding CASV location...`);

                        // Map consulate to CASV locations
                        const casvLocationMap = {
                          'Brasília': '58',        // Brasília ASC
                          'Porto Alegre': '58',    // Brasília ASC (Porto Alegre uses Brasília)
                          'Recife': '58',          // Brasília ASC (Recife uses Brasília)
                          'Rio de Janeiro': '59',  // Rio de Janeiro ASC
                          'São Paulo': '60'        // Sao Paulo ASC Unidade Vila Mariana
                        };

                        const casvValue = casvLocationMap[consulate];

                        if (casvValue) {
                          // Wait for CASV selection to be available
                          await page.waitForSelector('#appointments_asc_appointment_facility_id', { timeout: 10000 });

                          await page.select('#appointments_asc_appointment_facility_id', casvValue);
                          console.log(`   ✅ Successfully selected CASV location: ${casvValue} for ${consulate}`);

                          // Wait for CASV selection to register
                          await new Promise(resolve => setTimeout(resolve, 1000));

                          // Check for CASV dates that match the consulate date ±1 day
                          try {
                            console.log(`   📅 Checking CASV dates near consulate date ${selectedConsulateDate}...`);

                            // Click on CASV date input to open calendar
                            await page.click('#appointments_asc_appointment_date');
                            await new Promise(resolve => setTimeout(resolve, 2000));

                            // Navigate through CASV calendar months to find available dates
                            let casvDays = [];
                            let casvMonthsChecked = 0;
                            const maxCasvMonthsToCheck = 6; // Check up to 6 months ahead for CASV

                            console.log(`   📅 Navigating CASV calendar months...`);

                            while (casvMonthsChecked < maxCasvMonthsToCheck && casvDays.length === 0) {
                              console.log(`   Checking CASV month ${casvMonthsChecked + 1}...`);

                              // Check current month for available dates
                              const currentCasvDays = await page.$$eval('.ui-datepicker-calendar td', elements => {
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

                              if (currentCasvDays.length > 0) {
                                casvDays = currentCasvDays;
                                console.log(`   ✅ Found ${currentCasvDays.length} CASV dates in month ${casvMonthsChecked + 1}`);
                                break;
                              } else {
                                console.log(`   ❌ No CASV dates found in this month`);
                              }

                              // If no dates found in current month, try to navigate to next month
                              if (casvDays.length === 0 && casvMonthsChecked < maxCasvMonthsToCheck - 1) {
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
                                    console.log(`   ⚠️ Could not find CASV next month button, stopping navigation`);
                                    break;
                                  }
                                } catch (error) {
                                  console.log(`   ⚠️ Error navigating CASV to next month: ${error.message}`);
                                  break;
                                }
                              }

                              casvMonthsChecked++;
                            }

                            if (casvDays.length > 0) {
                              // Find CASV dates that are within ±1 day of consulate date
                              const matchingCasvDates = casvDays.filter(day => {
                                const casvDate = parseInt(day.date);
                                const difference = Math.abs(casvDate - selectedConsulateDate);
                                return difference <= 1; // Same day, or ±1 day
                              });

                              if (matchingCasvDates.length > 0) {
                                // Select the CASV date that best matches the consulate date
                                // Prefer same day, then closest date
                                let bestMatch = matchingCasvDates[0];
                                let bestDifference = Math.abs(parseInt(bestMatch.date) - selectedConsulateDate);

                                for (const casvDay of matchingCasvDates) {
                                  const difference = Math.abs(parseInt(casvDay.date) - selectedConsulateDate);
                                  if (difference < bestDifference) {
                                    bestMatch = casvDay;
                                    bestDifference = difference;
                                  }
                                }

                                console.log(`   ✅ Found matching CASV date: ${bestMatch.date} (diff: ${bestDifference} days)`);
                                console.log(`   📅 Available matching CASV dates: ${matchingCasvDates.map(d => d.date).join(', ')}`);

                                // Click on the best matching CASV date
                                const casvDayElements = await page.$$('.ui-datepicker-calendar td');
                                for (const dayElement of casvDayElements) {
                                  const text = await dayElement.evaluate(el => el.textContent?.trim());
                                  const className = await dayElement.evaluate(el => el.className);

                                  if (text === bestMatch.date &&
                                      !className.includes('ui-datepicker-unselectable') &&
                                      !className.includes('ui-state-disabled') &&
                                      !className.includes('ui-datepicker-other-month')) {

                                    await dayElement.click();
                                    console.log(`   ✅ Successfully selected CASV date: ${bestMatch.date}`);

                                    // Wait for CASV date selection to register
                                    await new Promise(resolve => setTimeout(resolve, 1000));

                                    // Select the earliest available CASV time slot
                                    try {
                                      console.log(`   ⏰ Looking for available CASV time slots...`);

                                      // Wait for CASV time options to load
                                      await page.waitForSelector('#appointments_asc_appointment_time option', { timeout: 10000 });

                                      // Get all available CASV time options
                                      const casvTimeOptions = await page.$$eval('#appointments_asc_appointment_time option', options => {
                                        return options.map(option => ({
                                          value: option.value,
                                          text: option.text.trim(),
                                          disabled: option.disabled
                                        })).filter(option => option.value && !option.disabled && option.text);
                                      });

                                      if (casvTimeOptions.length > 0) {
                                        // Select the first (earliest) CASV time slot
                                        const earliestCasvTime = casvTimeOptions[0];
                                        console.log(`   📅 Available CASV times: ${casvTimeOptions.map(t => t.text).join(', ')}`);
                                        console.log(`   🎯 Selecting earliest CASV time: ${earliestCasvTime.text}`);

                                        await page.select('#appointments_asc_appointment_time', earliestCasvTime.value);
                                        console.log(`   ✅ Successfully selected CASV time: ${earliestCasvTime.text}`);

                                        // Wait for CASV time selection to register
                                        await new Promise(resolve => setTimeout(resolve, 1000));

                                        // Successfully selected both consulate and CASV appointments
                                        const fullConsulateDate = formatFullDate(earliestDate);
                                        const fullCasvDate = formatFullDate(bestMatch.date);

                                        console.log(`\n🎉 APPOINTMENT SUCCESSFULLY SELECTED! 🎉`);
                                        console.log(`📅 Consulate Date: ${fullConsulateDate}`);
                                        console.log(`⏰ Consulate Time: ${latestTime.text}`);
                                        console.log(`🏢 CASV Date: ${fullCasvDate}`);
                                        console.log(`⏰ CASV Time: ${earliestCasvTime.text}`);

                                        // Check if this is a better date than previously found
                                        if (isBetterDate(earliestDate, bestDateFound)) {
                                          const previousBest = bestDateFound;
                                          bestDateFound = fullConsulateDate; // Store full date format

                                          console.log(`\n🏆 NEW BEST DATE FOUND! 🏆`);
                                          if (previousBest) {
                                            console.log(`📈 Previous best: ${previousBest}`);
                                          }
                                          console.log(`🎯 New best: ${bestDateFound}`);

                                          // Send Telegram notification
                                          const message = `
<b>🏆 NEW EARLIER APPOINTMENT FOUND! 🏆</b>

📍 <b>Consulate:</b> ${consulate}
📅 <b>Consulate Date:</b> ${fullConsulateDate}
⏰ <b>Consulate Time:</b> ${latestTime.text}
🏢 <b>CASV Date:</b> ${fullCasvDate}
⏰ <b>CASV Time:</b> ${earliestCasvTime.text}

${previousBest ? `📈 <b>Previous best date:</b> ${previousBest}` : '🎯 <b>This is the first appointment found!</b>'}

⏰ <b>Found at:</b> ${new Date().toLocaleString()}
🔄 <b>Check #:</b> ${checkCount}
                                          `.trim();

                                          await sendTelegramNotification(message);
                                        }

                                      } else {
                                        console.log(`   ❌ No CASV time slots available for selected date`);
                                      }

                                    } catch (casvTimeError) {
                                      console.log(`   ⚠️ Could not select CASV time slot: ${casvTimeError.message}`);
                                    }

                                    break;
                                  }
                                }

                              } else {
                                console.log(`   ❌ No CASV dates found within ±1 day of consulate date ${selectedConsulateDate}`);
                                console.log(`   📅 Available CASV dates: ${casvDays.map(d => d.date).join(', ')}`);
                                console.log(`   💡 We could not find a CASV date close to the most recent consulate interview available`);
                              }

                            } else {
                              console.log(`   ❌ No CASV dates available`);
                              console.log(`   💡 We could not find a CASV date close to the most recent consulate interview available`);
                            }

                          } catch (casvDateError) {
                            console.log(`   ⚠️ Could not check CASV dates: ${casvDateError.message}`);
                          }

                        } else {
                          console.log(`   ❌ No CASV location mapping found for consulate: ${consulate}`);
                        }

                      } catch (casvError) {
                        console.log(`   ⚠️ Could not select CASV location: ${casvError.message}`);
                      }

                    } else {
                      console.log(`   ❌ No time slots available for selected date`);
                    }

                  } catch (timeError) {
                    console.log(`   ⚠️ Could not select time slot: ${timeError.message}`);
                  }

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

