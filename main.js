const VisaScheduler = require('./src/scheduler/VisaScheduler');

/**
 * Visa Appointment Scheduler
 * 
 * A refactored, modular visa appointment monitoring system that:
 * - Monitors visa appointment availability
 * - Automatically books the earliest available appointments
 * - Sends Telegram notifications when appointments are found
 * - Handles session expiration and browser management
 * - Provides graceful shutdown and error handling
 */

async function main() {
  const scheduler = new VisaScheduler();
  
  try {
    // Initialize all components
    await scheduler.initialize();
    
    // Test systems (optional)
    await scheduler.testSystems();
    
    // Start monitoring
    await scheduler.start();
    
  } catch (error) {
    console.log(`💥 Failed to start scheduler: ${error.message}`);
    console.log(`🔧 Please check your configuration and try again.`);
    
    // Attempt graceful shutdown
    try {
      await scheduler.stop('Initialization failed');
    } catch (shutdownError) {
      console.log(`⚠️ Error during shutdown: ${shutdownError.message}`);
    }
    
    process.exit(1);
  }
}

// Start the application
main().catch(error => {
  console.log(`💥 Unhandled error in main: ${error.message}`);
  process.exit(1);
});
