-- Initialize AsiJS example database
-- Mounted at /docker-entrypoint-initdb.d/ — runs on first Postgres start

CREATE TABLE IF NOT EXISTS items (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Seed data
INSERT INTO items (name) VALUES
    ('AsiJS'),
    ('Docker'),
    ('PostgreSQL')
ON CONFLICT DO NOTHING;
