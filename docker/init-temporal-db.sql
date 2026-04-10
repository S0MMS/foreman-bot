-- Create Temporal databases (if they don't already exist)
-- This script runs on first Postgres startup only.

SELECT 'CREATE DATABASE temporal'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'temporal')\gexec

SELECT 'CREATE DATABASE temporal_visibility'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'temporal_visibility')\gexec
