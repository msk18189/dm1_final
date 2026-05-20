from database.database import engine
from sqlalchemy import text

tables = [
    "repositories",
    "pull_requests",
    "total_analysis",
    "contributors",
    "reviews",
    "ml_predictions",
]

with engine.connect() as conn:
    for t in tables:
        try:
            stmt = text(f"SHOW COLUMNS FROM {t}")
            res = conn.execute(stmt)
            print(f"\nColumns in {t}:")
            for row in res:
                print(row)
        except Exception as e:
            print(f"Error inspecting table {t}:", e)
