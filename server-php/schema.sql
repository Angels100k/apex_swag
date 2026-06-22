-- schema.sql — import into your cPanel MySQL database via phpMyAdmin.
-- Data is keyed by Apex player name + platform; no user accounts.

CREATE TABLE IF NOT EXISTS players (
    id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name        VARCHAR(64)  NOT NULL,
    platform    VARCHAR(16)  NOT NULL,
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_player (name, platform)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sessions (
    id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
    player_id      INT UNSIGNED NOT NULL,
    session_start  DATETIME     NOT NULL,
    session_end    DATETIME     NULL,
    start_rp       INT          NULL,
    current_rp     INT          NULL,
    predator_rp    INT          NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_session (player_id, session_start),
    CONSTRAINT fk_session_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS matches (
    id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
    player_id  INT UNSIGNED NOT NULL,
    session_id INT UNSIGNED NULL,
    ts         DATETIME     NOT NULL,
    rp_before  INT          NULL,
    rp_after   INT          NULL,
    delta      INT          NULL,
    rank_name  VARCHAR(32)  NULL,
    rank_div   VARCHAR(8)   NULL,
    ladder_pos INT          NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_match (player_id, ts),
    KEY idx_match_ts (ts),
    CONSTRAINT fk_match_player  FOREIGN KEY (player_id)  REFERENCES players(id)  ON DELETE CASCADE,
    CONSTRAINT fk_match_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
