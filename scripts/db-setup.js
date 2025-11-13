const { Client } = require('pg');
require('dotenv').config();

// Script to create database and run initial setup
async function setupDatabase() {
  try {
    // Connect using DATABASE_URL (for Neon cloud database)
    if (process.env.DATABASE_URL) {
      console.log('🔌 Connecting to Neon database...\n');
      
      const client = new Client({
        connectionString: process.env.DATABASE_URL,
        ssl: {
          rejectUnauthorized: false
        }
      });

      await client.connect();
      console.log('✅ Connected to Neon database\n');
      
      // Test connection
      const result = await client.query('SELECT NOW()');
      console.log('✅ Database connection verified:', result.rows[0].now);
      
      await client.end();
      console.log('\n✅ Database is ready!\n');

      // Now run migrations
      console.log('🚀 Running migrations...\n');
      
      const { execSync } = require('child_process');
      execSync('node scripts/migrate.js', { stdio: 'inherit' });

    } else {
      // Fallback to local PostgreSQL setup
      const adminClient = new Client({
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 5432,
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD,
        database: 'postgres',
      });

      await adminClient.connect();
      console.log('🔌 Connected to PostgreSQL server\n');

      const dbName = process.env.DB_NAME || 'aluma_banking';

      const checkDb = await adminClient.query(
        `SELECT 1 FROM pg_database WHERE datname = $1`,
        [dbName]
      );

      if (checkDb.rows.length === 0) {
        console.log(`📦 Creating database: ${dbName}`);
        await adminClient.query(`CREATE DATABASE ${dbName}`);
        console.log(`✅ Database created: ${dbName}\n`);
      } else {
        console.log(`✅ Database already exists: ${dbName}\n`);
      }

      await adminClient.end();

      console.log('🚀 Running migrations...\n');
      
      const { execSync } = require('child_process');
      execSync('node scripts/migrate.js', { stdio: 'inherit' });
    }

  } catch (error) {
    console.error('❌ Database setup failed:', error.message);
    console.error('Full error:', error);
    process.exit(1);
  }
}

// Run setup
setupDatabase();