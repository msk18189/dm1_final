import re
import os

files = [
    "e:/final/dm1_final/backend/services/filters.py",
    "e:/final/dm1_final/backend/services/extended_analytics.py",
    "e:/final/dm1_final/backend/services/module_analytics.py",
]

def refactor_file(filepath):
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()

    if "result.all(    .distinct()" in content:
        content = content.replace("result.all(    .distinct()\n        .all()\n    )", "result.scalars().all()")
    pass

if __name__ == "__main__":
    for f in files:
        refactor_file(f)
