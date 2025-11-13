// scripts/activate-user.js
require('dotenv').config();
const { Client } = require('pg');

const activateUser = async () => {
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

    // Update user status to active
    const result = await client.query(
      `UPDATE users SET status = 'active', email_verified = true WHERE email = $1 RETURNING id, email, status`,
      [email]
    );

    if (result.rows.length > 0) {
      console.log('✅ User activated successfully!');
      console.log('Email:', result.rows[0].email);
      console.log('Status:', result.rows[0].status);
    } else {
      console.log('❌ User not found with email:', email);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
};

activateUser();