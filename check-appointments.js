require('dotenv').config();
const AppConfig = require('./src/config/AppConfig');
const BrowserManager = require('./src/browser/BrowserManager');
const AuthHandler = require('./src/auth/AuthHandler');

async function checkAppointments() {
  console.log('🔍 Starting appointment checker...');
  
  let config, browser, auth;
  try {
    // Initialize components (similar to VisaScheduler)
    console.log('🎯 Initializing components...');
    
    // Initialize configuration
    config = new AppConfig();
    
    // Initialize browser manager
    browser = new BrowserManager(config);
    
    // Launch browser
    await browser.launch();
    console.log('✅ Browser launched successfully');
    
    // Initialize auth handler
    auth = new AuthHandler(config, browser);
    
    // Perform login
    console.log('🔐 Logging in...');
    await auth.login();
    console.log('✅ Login successful');
    
    // Get current URL to extract group ID
    const currentUrl = await browser.getCurrentUrl();
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
    await browser.navigateTo(appointmentsUrl);
    
    // Wait for page to load
    await browser.wait(3000);

    // Check for existing appointments
    console.log('\n🔍 Checking for appointment elements...');
    
    // After checking appointments, navigate to the scheduling page
    console.log(`\n🔍 Navigating to appointment scheduling page...`);
    const appointmentUrl = config.get('urls.appointment');
    await browser.navigateTo(appointmentUrl);
    await browser.wait(3000);
    console.log(`✅ Successfully navigated to appointment page`);
    
    // Check for appointment elements using browser manager
    const appointmentInfo = await browser.evaluate(() => {
      const result = {
        debug: {} // Add debug information
      };
      
      // Look for consular appointment in elements with class "consular-appt"
      const consularElement = document.querySelector('.consular-appt');
      if (consularElement) {
        const consularText = consularElement.textContent || consularElement.innerText;
        result.consularHtml = consularElement.outerHTML;
        result.consularText = consularText;
        result.debug.consularText = consularText; // Save for debugging
        
        // Simple string manipulation approach for "Agendamento consular: 29 Agosto, 2025, 10:30 Brasília"
        try {
          // Strip prefix and extract the date part
          let dateText = consularText;
          if (dateText.includes('Agendamento consular:')) {
            dateText = dateText.split('Agendamento consular:')[1].trim();
          }
          
          // Parse the components - format will be like "29 Agosto, 2025, 10:30 Brasília"
          const parts = dateText.split(/[\s,]+/).filter(part => part.trim().length > 0);
          console.log('Consular parts:', parts);
          
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
            
            result.debug.consularParsedParts = parts;
          } else {
            result.debug.consularParsingFailed = true;
            result.debug.consularParts = parts;
          }
        } catch (e) {
          result.debug.consularError = e.toString();
          result.debug.consularParsingFailed = true;
        }
      } else {
        result.debug.consularElementNotFound = true;
        result.consularHtml = 'Not found';
        result.consularText = 'Not found';
      }
      
      // Look for CASV appointment in elements with class "asc-appt"
      const casvElement = document.querySelector('.asc-appt');
      if (casvElement) {
        const casvText = casvElement.textContent || casvElement.innerText;
        result.casvHtml = casvElement.outerHTML;
        result.casvText = casvText;
        result.debug.casvText = casvText; // Save for debugging
        
        // Simple string manipulation approach for "Agendamento no CASV: 29 Agosto, 2025, 08:00 Brasília"
        try {
          // Strip prefix and extract the date part
          let dateText = casvText;
          if (dateText.includes('Agendamento no CASV:')) {
            dateText = dateText.split('Agendamento no CASV:')[1].trim();
          }
          
          // Parse the components - format will be like "29 Agosto, 2025, 08:00 Brasília"
          const parts = dateText.split(/[\s,]+/).filter(part => part.trim().length > 0);
          console.log('CASV parts:', parts);
          
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
            
            result.debug.casvParsedParts = parts;
          } else {
            result.debug.casvParsingFailed = true;
            result.debug.casvParts = parts;
          }
        } catch (e) {
          result.debug.casvError = e.toString();
          result.debug.casvParsingFailed = true;
        }
      } else {
        result.debug.casvElementNotFound = true;
        result.casvHtml = 'Not found';
        result.casvText = 'Not found';
      }
      
      // If nothing else worked, look for any paragraph that contains date information
      if (!result.consulate && !result.casv) {
        const allParagraphs = Array.from(document.querySelectorAll('p'));
        result.debug.paragraphsCount = allParagraphs.length;
        
        // Collect the text of all paragraphs for debugging
        result.allParagraphs = allParagraphs.map(p => ({
          className: p.className,
          text: p.textContent || p.innerText
        }));
        
        // Try to find paragraphs that might contain appointment information
        const datePattern = /(\d{1,2})\s+(\w+),\s*(\d{4})/i;
        
        for (const p of allParagraphs) {
          const text = p.textContent || p.innerText;
          if (datePattern.test(text)) {
            if (text.toLowerCase().includes('consular')) {
              result.debug.foundConsularInParagraph = text;
            }
            if (text.toLowerCase().includes('casv') || text.toLowerCase().includes('asc')) {
              result.debug.foundCASVInParagraph = text;
            }
          }
        }
      } else {
        // Still collect all paragraphs for reference
        const allParagraphs = Array.from(document.querySelectorAll('p'));
        result.allParagraphs = allParagraphs.map(p => ({
          className: p.className,
          text: p.textContent || p.innerText
        }));
      }
      
      return result;
    });
    
    // Print debug information
    if (appointmentInfo.debug) {
      console.log(`\n🔍 Debug information for appointment detection:`);
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
      if (appointmentInfo.debug.foundConsularInParagraph) {
        console.log(`   🔍 Found potential consular appointment in paragraph: "${appointmentInfo.debug.foundConsularInParagraph}"`);
      }
      if (appointmentInfo.debug.foundCASVInParagraph) {
        console.log(`   🔍 Found potential CASV appointment in paragraph: "${appointmentInfo.debug.foundCASVInParagraph}"`);
      }
    }
    
    // Print results
    console.log('\n==== CONSULAR APPOINTMENT ====');
    console.log('Text:', appointmentInfo.consularText);
    console.log('HTML:', appointmentInfo.consularHtml);
    
    console.log('\n==== CASV APPOINTMENT ====');
    console.log('Text:', appointmentInfo.casvText);
    console.log('HTML:', appointmentInfo.casvHtml);
    
    // Print parsed appointment information
    if (appointmentInfo.consulate) {
      console.log('\n==== PARSED CONSULAR APPOINTMENT ====');
      console.log(appointmentInfo.consulate);
      
      // Convert to DD-MM-YYYY format
      const monthMap = {
        'janeiro': '01', 'fevereiro': '02', 'março': '03', 'abril': '04',
        'maio': '05', 'junho': '06', 'julho': '07', 'agosto': '08',
        'setembro': '09', 'outubro': '10', 'novembro': '11', 'dezembro': '12'
      };
      
      const day = appointmentInfo.consulate.day.padStart(2, '0');
      const monthKey = appointmentInfo.consulate.month.toLowerCase();
      const month = monthMap[monthKey] || '01';
      const year = appointmentInfo.consulate.year;
      
      const formattedDate = `${day}-${month}-${year}`;
      console.log(`📅 Formatted date: ${formattedDate}`);
    }
    
    if (appointmentInfo.casv) {
      console.log('\n==== PARSED CASV APPOINTMENT ====');
      console.log(appointmentInfo.casv);
      
      // Convert to DD-MM-YYYY format
      const monthMap = {
        'janeiro': '01', 'fevereiro': '02', 'março': '03', 'abril': '04',
        'maio': '05', 'junho': '06', 'julho': '07', 'agosto': '08',
        'setembro': '09', 'outubro': '10', 'novembro': '11', 'dezembro': '12'
      };
      
      const day = appointmentInfo.casv.day.padStart(2, '0');
      const monthKey = appointmentInfo.casv.month.toLowerCase();
      const month = monthMap[monthKey] || '01';
      const year = appointmentInfo.casv.year;
      
      const formattedDate = `${day}-${month}-${year}`;
      console.log(`📅 Formatted date: ${formattedDate}`);
    }
    
    // Print all paragraphs for additional context
    console.log('\n==== ALL PARAGRAPHS ====');
    if (appointmentInfo.allParagraphs) {
      appointmentInfo.allParagraphs.forEach((p, index) => {
        console.log(`[${index}] Class: "${p.className}", Text: "${p.text.trim()}"`);
      });
    } else {
      console.log('No paragraphs collected');
    }
    
    // Parse dates using the VisaScheduler's method
    if (appointmentInfo.consulate) {
      const consularDate = parsePortugueseDate(appointmentInfo.consulate);
      console.log(`\n📅 Parsed Consular Date for comparison: ${consularDate}`);
      
      // Compare against maxDate
      const maxDate = config.get('maxDate');
      console.log(`\n📅 Max Date from config: ${maxDate}`);
      
      const isImprovement = isDateImprovement(consularDate, maxDate);
      console.log(`\n${isImprovement ? '✅' : '❌'} Date ${consularDate} is ${isImprovement ? 'better than' : 'not better than'} max date ${maxDate}`);
    }
    
  } catch (error) {
    console.error('💥 Error:', error);
  } finally {
    console.log('🔍 Checker finished, keeping browser open for inspection');
    // Keep browser open for manual inspection
    // Uncomment to close automatically: await browser?.close();
  }
}

// Parse Portuguese date (same as VisaScheduler._parsePortugueseDate)
function parsePortugueseDate(dateObj) {
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

// Check if date is an improvement (similar to AppointmentBooker._checkDateImprovement)
function isDateImprovement(newDate, comparisonDate) {
  // Convert dates to comparable format (YYYYMMDD)
  const newComparable = dateToComparable(newDate);
  const baselineComparable = dateToComparable(comparisonDate);
  
  // Earlier date is better (smaller number)
  return newComparable < baselineComparable;
}

// Convert date to comparable format (same as AppointmentBooker._dateToComparable)
function dateToComparable(dateStr) {
  if (typeof dateStr === 'string' && dateStr.includes('-')) {
    const [day, month, year] = dateStr.split('-').map(Number);
    return year * 10000 + month * 100 + day;
  } else {
    throw new Error(`Invalid date format: ${dateStr}. Expected DD-MM-YYYY format.`);
  }
}

// Run the function
checkAppointments();