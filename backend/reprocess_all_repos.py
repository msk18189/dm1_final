"""
Reprocess all repositories to ensure all data is populated.
"""
from database.database import SessionLocal
from services.data_processor import DataProcessor

def reprocess_all_repos():
    """Reprocess all existing repositories in the database."""
    db = SessionLocal()
    processor = DataProcessor(db)
    
    try:
        from database.models import Repository
        
        repos = db.query(Repository).all()
        print(f"\nFound {len(repos)} repositories to reprocess")
        
        for repo in repos:
            full_url = f"https://github.com/{repo.owner}/{repo.name}"
            print(f"\n{'='*60}")
            print(f"Reprocessing: {full_url}")
            print(f"{'='*60}")
            
            try:
                result = processor.process_repository(full_url)
                print(f"✓ Successfully reprocessed {repo.owner}/{repo.name}")
            except Exception as e:
                print(f"✗ Error reprocessing {repo.owner}/{repo.name}: {str(e)}")
        
        print(f"\n{'='*60}")
        print("All repositories have been reprocessed!")
        print(f"{'='*60}\n")
        
    finally:
        db.close()

if __name__ == "__main__":
    reprocess_all_repos()
