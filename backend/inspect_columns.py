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

is_sqlite = engine.url.drivername.startswith("sqlite")

with engine.connect() as conn:
    for t in tables:
        try:
            if is_sqlite:
                stmt = text(f"PRAGMA table_info({t})")
            else:
                stmt = text(f"SHOW COLUMNS FROM {t}")
            res = conn.execute(stmt)
            print(f"\nColumns in {t}:")
            for row in res:
                if is_sqlite:
                    # PRAGMA table_info returns (cid, name, type, notnull, dflt_value, pk)
                    print(f"Name: {row[1]}, Type: {row[2]}, Nullable: {not row[3]}, Key: {'PRI' if row[5] else ''}")
                else:
                    print(row)
        except Exception as e:
            print(f"Error inspecting table {t}:", e)

