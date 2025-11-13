// scripts/create-account.js
require('dotenv').config();
const { Client } = require('pg');

const createAccount = async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    const email = process.argv[2] || 'barsolomonokpai@gmail.com';

    // Get user ID
    const userResult = await client.query(
      `SELECT id, email, first_name, last_name FROM users WHERE email = $1`,
      [email]
    );

    if (userResult.rows.length === 0) {
      console.log('❌ User not found with email:', email);
      return;
    }

    const user = userResult.rows[0];
    console.log('Found user:', user.email);

    // Generate account number
    const accountNumber = 'ALU' + Date.now().toString().slice(-10);

    // Create account
    const accountResult = await client.query(
      `INSERT INTO accounts (
        user_id, 
        account_number, 
        account_type, 
        account_name, 
        status, 
        cash_balance, 
        buying_power
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, account_number, account_type, cash_balance`,
      [
        user.id,
        accountNumber,
        'individual',
        `${user.first_name || 'Primary'} Trading Account`,
        'active',
        10000.00, // Starting balance of $10,000
        10000.00
      ]
    );

    console.log('\n✅ Account created successfully!');
    console.log('Account Number:', accountResult.rows[0].account_number);
    console.log('Account Type:', accountResult.rows[0].account_type);
    console.log('Starting Balance:', `$${accountResult.rows[0].cash_balance}`);

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
};

createAccount();