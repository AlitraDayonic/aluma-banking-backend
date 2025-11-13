// ============================================
// scripts/migrate.js
// Database Migration Script
// ============================================

require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

// Use DATABASE_URL if available (Neon), otherwise use individual variables (local)
const clientConfig = process.env.DATABASE_URL 
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false
      }
    }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME || 'aluma_db',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD
    };

const client = new Client(clientConfig);

const runMigration = async () => {
  try {
    console.log('🔌 Connecting to database...');
    await client.connect();
    console.log('✅ Connected to database\n');

    // Read the schema file
    const schemaPath = path.join(__dirname, '../database/schema.sql');
    
    if (!fs.existsSync(schemaPath)) {
      console.error('❌ Schema file not found at:', schemaPath);
      process.exit(1);
    }

    const fullSchema = fs.readFileSync(schemaPath, 'utf8');

    console.log('🔄 Running migrations in sections...\n');
    
    // Split schema into logical sections
    const sections = [
      { name: 'Extensions', pattern: /CREATE EXTENSION.*?;/gs },
      { name: 'Enums', pattern: /CREATE TYPE.*?;/gs },
      { name: 'Tables', pattern: /CREATE TABLE.*?(?=CREATE TABLE|CREATE INDEX|CREATE VIEW|CREATE OR REPLACE FUNCTION|CREATE TRIGGER|ALTER TABLE|INSERT INTO|DO \$|$)/gs },
      { name: 'Indexes', pattern: /CREATE INDEX.*?;/gs },
      { name: 'Views', pattern: /CREATE VIEW.*?;/gs }
    ];

    for (const section of sections) {
      console.log(`📦 Processing ${section.name}...`);
      const matches = fullSchema.match(section.pattern);
      if (matches) {
        for (const statement of matches) {
          const trimmed = statement.trim();
          if (trimmed) {
            try {
              await client.query(trimmed);
              process.stdout.write('.');
            } catch (error) {
              console.log(`\n⚠️  Error in ${section.name}:`, error.message);
              console.log('Statement:', trimmed.substring(0, 100) + '...');
            }
          }
        }
        console.log(` ✅`);
      }
    }

    // Handle functions separately (they use $ delimiters)
console.log(`\n📦 Processing Functions...`);
const functionPattern = /CREATE OR REPLACE FUNCTION[\s\S]*?LANGUAGE plpgsql;/gi;
const functions = fullSchema.match(functionPattern);

if (functions) {
  for (const func of functions) {
    try {
      await client.query(func);
      process.stdout.write('.');
    } catch (error) {
      console.log(`\n⚠️  Error in function:`, error.message);
      const funcName = func.match(/FUNCTION\s+(\w+)/i);
      console.log('Function:', funcName ? funcName[1] : 'unknown');
      console.log('First 200 chars:', func.substring(0, 200));
    }
  }
  console.log(` ✅`);
} else {
  console.log(' ⚠️  No functions found!');
}
    // Handle triggers
    console.log(`\n📦 Processing Triggers...`);
    const triggerPattern = /CREATE TRIGGER.*?;/gs;
    const triggers = fullSchema.match(triggerPattern);
    
    if (triggers) {
      for (const trigger of triggers) {
        try {
          await client.query(trigger);
          process.stdout.write('.');
        } catch (error) {
          console.log(`\n⚠️  Error in trigger:`, error.message);
        }
      }
      console.log(` ✅`);
    }

    // Handle ALTER TABLE statements
    console.log(`\n📦 Processing ALTER statements...`);
    const alterPattern = /ALTER TABLE.*?;/gs;
    const alters = fullSchema.match(alterPattern);
    
    if (alters) {
      for (const alter of alters) {
        try {
          await client.query(alter);
          process.stdout.write('.');
        } catch (error) {
          console.log(`\n⚠️  Error in ALTER:`, error.message);
        }
      }
      console.log(` ✅`);
    }

    // Handle INSERT statements
    console.log(`\n📦 Processing INSERT statements...`);
    const insertPattern = /INSERT INTO.*?;/gs;
    const inserts = fullSchema.match(insertPattern);
    
    if (inserts) {
      for (const insert of inserts) {
        try {
          await client.query(insert);
          process.stdout.write('.');
        } catch (error) {
          console.log(`\n⚠️  Error in INSERT:`, error.message);
        }
      }
      console.log(` ✅`);
    }

    // Handle CREATE POLICY statements
    console.log(`\n📦 Processing Security Policies...`);
    const policyPattern = /CREATE POLICY.*?;/gs;
    const policies = fullSchema.match(policyPattern);
    
    if (policies) {
      for (const policy of policies) {
        try {
          await client.query(policy);
          process.stdout.write('.');
        } catch (error) {
          console.log(`\n⚠️  Error in POLICY:`, error.message);
        }
      }
      console.log(` ✅`);
    }

    // Handle COMMENT statements
    console.log(`\n📦 Processing Comments...`);
    const commentPattern = /COMMENT ON.*?;/gs;
    const comments = fullSchema.match(commentPattern);
    
    if (comments) {
      for (const comment of comments) {
        try {
          await client.query(comment);
          process.stdout.write('.');
        } catch (error) {
          // Comments failing is not critical
        }
      }
      console.log(` ✅`);
    }

    // Handle DO blocks
    console.log(`\n📦 Processing DO blocks...`);
    const doPattern = /DO \$[\s\S]*?\$;/gi;
    const doBlocks = fullSchema.match(doPattern);
    
    if (doBlocks) {
      for (const doBlock of doBlocks) {
        try {
          await client.query(doBlock);
          process.stdout.write('.');
        } catch (error) {
          console.log(`\n⚠️  Error in DO block:`, error.message);
        }
      }
      console.log(` ✅`);
    }

    console.log('\n\n📊 Database Summary:');
    
    // Get table count
    const tablesResult = await client.query(`
      SELECT COUNT(*) as count
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `);
    console.log(`   Tables created: ${tablesResult.rows[0].count}`);

    // Get view count
    const viewsResult = await client.query(`
      SELECT COUNT(*) as count
      FROM information_schema.views
      WHERE table_schema = 'public'
    `);
    console.log(`   Views created: ${viewsResult.rows[0].count}`);

    // List all tables
    const tablesList = await client.query(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `);
    
    console.log('\n📋 Tables created:');
    tablesList.rows.forEach(row => {
      console.log(`   ✓ ${row.tablename}`);
    });

    console.log('\n✅ Migration completed successfully!');

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error('Full error:', error);
    process.exit(1);
  } finally {
    await client.end();
    console.log('\n🔌 Database connection closed');
  }
};

// Run migration
runMigration();