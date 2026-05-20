import sqlite3
import os

db_path = os.path.join(os.path.dirname(__file__), "pr_dashboard.db")
print("Connecting to:", db_path)
conn = sqlite3.connect(db_path)
c = conn.cursor()

try:
    c.execute("UPDATE repositories SET full_name = owner || '/' || name WHERE full_name IS NULL")
    c.execute("UPDATE repositories SET url = 'https://github.com/' || owner || '/' || name WHERE url IS NULL")
    c.execute("UPDATE repositories SET source_url = url WHERE source_url IS NULL OR source_url = ''")
    conn.commit()
    print("Database fix completed! Total changes:", conn.total_changes)
except Exception as e:
    print("Error during database update:", e)
finally:
    conn.close()
