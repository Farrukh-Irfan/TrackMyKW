CREATE TABLE IF NOT EXISTS keywords (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
    tcin TEXT PRIMARY KEY,
    title TEXT,
    brand TEXT,
    mine INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    keyword_id TEXT NOT NULL,
    tcin TEXT NOT NULL,
    rank INTEGER,
    price REAL,
    reviews INTEGER,
    captured_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (keyword_id) REFERENCES keywords(id),
    FOREIGN KEY (tcin) REFERENCES products(tcin)
);
