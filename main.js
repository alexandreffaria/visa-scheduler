require('dotenv').config();
const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();
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

  // Select consulate location
  const consulate = process.env.VISA_CONSULATE || 'Brasília';
  console.log(`➡️ Selecting consulate: ${consulate}`);

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
    console.log(`➡️ Successfully selected consulate: ${consulate} (value: ${consulateValue})`);
  } else {
    console.log(`❌ Consular not found in mapping: ${consulate}`);
  }

  // keep browser open for now
  // await browser.close();
})();

