#!/usr/bin/env python
"""Simple backend startup script"""
import uvicorn
import os
import sys

# Ensure we're in the backend directory
os.chdir(os.path.dirname(os.path.abspath(__file__)))

if __name__ == "__main__":
    print("Starting GitHub PR Intelligence Dashboard Backend...")
    print("Server will be available at http://localhost:8000")
    print("API docs at http://localhost:8000/docs")
    
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )
