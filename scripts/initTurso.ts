#!/usr/bin/env node
import { initializeDatabase } from '../services/tursoService.node.js';

async function main() {
  try {
    console.log('Initializing Turso database...');
    await initializeDatabase();
    console.log('✅ Turso database initialized successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Failed to initialize Turso database:', error);
    process.exit(1);
  }
}

main();
