from database.database import engine
from sqlalchemy import text

statements = [
    "ALTER TABLE repositories ADD COLUMN name VARCHAR(255)",
    "ALTER TABLE repositories ADD COLUMN full_name VARCHAR(511)",
    "ALTER TABLE repositories ADD COLUMN url VARCHAR(1024)",
    "ALTER TABLE repositories ADD COLUMN source_url VARCHAR(1024)",
    "ALTER TABLE repositories ADD COLUMN last_synced DATETIME",
    "ALTER TABLE repositories ADD COLUMN created_at DATETIME",
    "ALTER TABLE repositories ADD COLUMN updated_at DATETIME",
    "ALTER TABLE total_analysis ADD COLUMN repo_owner VARCHAR(255)",
    "ALTER TABLE total_analysis ADD COLUMN repo_name VARCHAR(255)",
    "ALTER TABLE pull_requests ADD COLUMN repo_owner VARCHAR(255)",
    "ALTER TABLE pull_requests ADD COLUMN repo_name VARCHAR(255)",
    "ALTER TABLE reviews ADD COLUMN repo_owner VARCHAR(255)",
    "ALTER TABLE reviews ADD COLUMN repo_name VARCHAR(255)",
    "ALTER TABLE contributors ADD COLUMN repo_owner VARCHAR(255)",
    "ALTER TABLE contributors ADD COLUMN repo_name VARCHAR(255)",
    "ALTER TABLE ml_predictions ADD COLUMN repo_owner VARCHAR(255)",
    "ALTER TABLE ml_predictions ADD COLUMN repo_name VARCHAR(255)",
    # populate new columns from legacy repo_name
    "UPDATE repositories SET full_name = CONCAT(owner, '/', name) WHERE full_name IS NULL",
    "UPDATE repositories SET url = CONCAT('https://github.com/', owner, '/', name) WHERE url IS NULL",
    "UPDATE repositories SET source_url = url WHERE source_url IS NULL OR source_url = ''",
    "UPDATE repositories SET source_url = url WHERE source_url IS NULL OR source_url = ''",
    "UPDATE repositories SET created_at = NOW() WHERE created_at IS NULL",
    "UPDATE repositories SET updated_at = NOW() WHERE updated_at IS NULL",
    "UPDATE pull_requests p JOIN repositories r ON p.repo_id = r.id SET p.repo_owner = r.owner, p.repo_name = r.name WHERE p.repo_owner IS NULL OR p.repo_owner = '' OR p.repo_name IS NULL OR p.repo_name = ''",
    "UPDATE contributors c JOIN repositories r ON c.repo_id = r.id SET c.repo_owner = r.owner, c.repo_name = r.name WHERE c.repo_owner IS NULL OR c.repo_owner = '' OR c.repo_name IS NULL OR c.repo_name = ''",
    "UPDATE ml_predictions m JOIN pull_requests p ON m.pr_id = p.id SET m.repo_owner = p.repo_owner, m.repo_name = p.repo_name WHERE m.repo_owner IS NULL OR m.repo_owner = '' OR m.repo_name IS NULL OR m.repo_name = ''",
    "UPDATE reviews v JOIN pull_requests p ON v.pr_id = p.id SET v.repo_owner = p.repo_owner, v.repo_name = p.repo_name WHERE v.repo_owner IS NULL OR v.repo_owner = '' OR v.repo_name IS NULL OR v.repo_name = ''",
    "UPDATE total_analysis t JOIN repositories r ON t.repo_id = r.id SET t.repo_owner = r.owner, t.repo_name = r.name WHERE t.repo_owner IS NULL OR t.repo_owner = '' OR t.repo_name IS NULL OR t.repo_name = ''",
    "INSERT INTO total_analysis (repo_id, repo_owner, repo_name, total_prs, open_prs, merged_prs, closed_prs, avg_cycle_time, merge_rate, avg_review_duration, avg_wait_for_review, stale_pr_count, created_at, updated_at) SELECT r.id, r.owner, r.name, COUNT(p.id), SUM(p.state='OPEN'), SUM(p.state='MERGED'), SUM(p.state IN ('MERGED','CLOSED')), IFNULL(ROUND(AVG(p.cycle_time_days),2),0), IFNULL(ROUND(SUM(p.state='MERGED')/NULLIF(SUM(p.state IN ('MERGED','CLOSED')),0)*100,2),0), IFNULL(ROUND(AVG(p.review_duration_hours)/24,2),0), IFNULL(ROUND(AVG(p.wait_for_review_hours)/24,2),0), SUM(p.state='OPEN' AND p.created_at < DATE_SUB(NOW(), INTERVAL 30 DAY)), NOW(), NOW() FROM repositories r LEFT JOIN pull_requests p ON p.repo_id = r.id WHERE NOT EXISTS (SELECT 1 FROM total_analysis t WHERE t.repo_id = r.id) GROUP BY r.id",
    # remove legacy column and index that still cause empty-string default collisions
    "ALTER TABLE repositories DROP INDEX ix_repositories_repo_name",
    "ALTER TABLE repositories DROP INDEX full_name_2",
    "ALTER TABLE repositories DROP INDEX url_2",
    "ALTER TABLE repositories DROP COLUMN repo_name",
    # enforce NOT NULL on `name` and add unique constraints for full_name and url
    "UPDATE repositories SET url = CONCAT('https://github.com/', owner, '/', name) WHERE url IS NULL OR url = ''",
    "ALTER TABLE repositories MODIFY COLUMN name VARCHAR(255) NOT NULL",
    "ALTER TABLE repositories MODIFY COLUMN full_name VARCHAR(511) NOT NULL",
    "ALTER TABLE repositories MODIFY COLUMN url VARCHAR(1024) NOT NULL",
    "ALTER TABLE repositories MODIFY COLUMN source_url VARCHAR(1024) NOT NULL",
    "ALTER TABLE repositories MODIFY COLUMN created_at DATETIME NOT NULL",
    "ALTER TABLE repositories MODIFY COLUMN updated_at DATETIME NOT NULL",
    "ALTER TABLE total_analysis MODIFY COLUMN repo_owner VARCHAR(255) NOT NULL",
    "ALTER TABLE total_analysis MODIFY COLUMN repo_name VARCHAR(255) NOT NULL",
    "ALTER TABLE pull_requests MODIFY COLUMN repo_owner VARCHAR(255) NOT NULL",
    "ALTER TABLE pull_requests MODIFY COLUMN repo_name VARCHAR(255) NOT NULL",
    "ALTER TABLE reviews MODIFY COLUMN repo_owner VARCHAR(255) NOT NULL",
    "ALTER TABLE reviews MODIFY COLUMN repo_name VARCHAR(255) NOT NULL",
    "ALTER TABLE contributors MODIFY COLUMN repo_owner VARCHAR(255) NOT NULL",
    "ALTER TABLE contributors MODIFY COLUMN repo_name VARCHAR(255) NOT NULL",
    "ALTER TABLE ml_predictions MODIFY COLUMN repo_owner VARCHAR(255) NOT NULL",
    "ALTER TABLE ml_predictions MODIFY COLUMN repo_name VARCHAR(255) NOT NULL",
    "ALTER TABLE repositories ADD UNIQUE (full_name)",
    "ALTER TABLE repositories ADD UNIQUE (url)",
]

with engine.connect() as conn:
    for stmt in statements:
        try:
            print('Executing:', stmt)
            conn.execute(text(stmt))
            print('OK')
        except Exception as e:
            print('Skipped/failed:', stmt, e)
