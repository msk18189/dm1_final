import os
import sys
from datetime import datetime
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch, mm
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Image, PageBreak, Table, TableStyle, ListFlowable, ListItem, Preformatted
)
from reportlab.platypus.tableofcontents import TableOfContents

# Ensure fonts
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

def generate_report(output_filename):
    doc = SimpleDocTemplate(
        output_filename,
        pagesize=A4,
        rightMargin=72,
        leftMargin=72,
        topMargin=72,
        bottomMargin=72
    )

    styles = getSampleStyleSheet()
    
    # Custom styles
    styles.add(ParagraphStyle(name='CoverTitle', fontSize=28, alignment=1, spaceAfter=20, fontName="Helvetica-Bold"))
    styles.add(ParagraphStyle(name='CoverSubtitle', fontSize=18, alignment=1, spaceAfter=30, textColor=colors.dimgrey))
    styles.add(ParagraphStyle(name='CoverInfo', fontSize=14, alignment=1, spaceAfter=10))
    
    styles.add(ParagraphStyle(name='CustomHeading1', fontSize=20, spaceBefore=20, spaceAfter=10, fontName="Helvetica-Bold"))
    styles.add(ParagraphStyle(name='CustomHeading2', fontSize=16, spaceBefore=15, spaceAfter=8, fontName="Helvetica-Bold", textColor=colors.darkblue))
    styles.add(ParagraphStyle(name='CustomHeading3', fontSize=14, spaceBefore=12, spaceAfter=6, fontName="Helvetica-Bold", textColor=colors.darkslategrey))
    
    styles.add(ParagraphStyle(name='BodyTextCustom', fontSize=11, spaceBefore=6, spaceAfter=6, leading=14, fontName="Helvetica"))
    styles.add(ParagraphStyle(name='CodeStyle', fontSize=9, fontName="Courier", backColor=colors.lightgrey, spaceBefore=6, spaceAfter=6, leftIndent=10, rightIndent=10, leading=11))

    Story = []

    # 1. Cover Page
    Story.append(Spacer(1, 2*inch))
    Story.append(Paragraph("PRISM: GitHub Engineering Intelligence Platform", styles['CoverTitle']))
    Story.append(Paragraph("Final Year / Internship Project Report", styles['CoverSubtitle']))
    Story.append(Spacer(1, 1*inch))
    Story.append(Paragraph("Developed by: PRISM Team", styles['CoverInfo']))
    Story.append(Paragraph("Organization: DM Internship", styles['CoverInfo']))
    Story.append(Paragraph(f"Date: {datetime.now().strftime('%B %Y')}", styles['CoverInfo']))
    Story.append(Spacer(1, 1*inch))
    Story.append(Paragraph("Technology Stack: React, Next.js, FastAPI, MySQL", styles['CoverInfo']))
    Story.append(PageBreak())

    # 2. Certificate Page
    Story.append(Paragraph("Certificate", styles['CustomHeading1']))
    Story.append(Spacer(1, 0.5*inch))
    Story.append(Paragraph("This is to certify that the project entitled 'PRISM: GitHub Engineering Intelligence Platform' is a bonafide record of independent project work done by the candidate under my supervision and guidance. This project is submitted in partial fulfillment of the requirements for the internship.", styles['BodyTextCustom']))
    Story.append(Spacer(1, 2*inch))
    Story.append(Paragraph("___________________________", styles['BodyTextCustom']))
    Story.append(Paragraph("Signature of Project Guide", styles['BodyTextCustom']))
    Story.append(PageBreak())

    # 3. Acknowledgement
    Story.append(Paragraph("Acknowledgement", styles['CustomHeading1']))
    Story.append(Paragraph("I would like to express my profound gratitude to everyone who contributed to the successful completion of this project. Special thanks to my mentors for their guidance, constructive criticism, and encouragement.", styles['BodyTextCustom']))
    Story.append(PageBreak())

    # 4. Abstract
    Story.append(Paragraph("Abstract", styles['CustomHeading1']))
    Story.append(Paragraph("PRISM is an advanced, enterprise-grade GitHub repository intelligence platform. It provides comprehensive analytics across Pull Requests, Issues, Branches, CI/CD Workflows, Forks, Discussions, and Projects. The platform is designed to give engineering leadership deep visibility into development velocity, bottleneck identification, and code health. Using a modern Next.js frontend and a FastAPI backend with MySQL, PRISM ingests real-time data from GitHub and visualizes it through rich, dynamic dashboards.", styles['BodyTextCustom']))
    Story.append(PageBreak())

    # 5. Table of Contents
    # (Simplified for this script)
    Story.append(Paragraph("Table of Contents", styles['CustomHeading1']))
    toc_items = [
        "1. Introduction", "2. Technology Stack", "3. System Architecture",
        "4. Folder Structure Analysis", "5. Module Description", "6. Database Design",
        "7. API Documentation", "8. UI/UX Screenshots", "9. Workflow and Execution",
        "10. Features", "11. Security Features", "12. Performance Optimization",
        "13. Testing", "14. Deployment", "15. Challenges and Solutions",
        "16. Future Enhancements", "17. Conclusion", "18. References", "19. Appendix"
    ]
    for item in toc_items:
        Story.append(Paragraph(item, styles['BodyTextCustom']))
    Story.append(PageBreak())

    # 6. Introduction
    Story.append(Paragraph("1. Introduction", styles['CustomHeading1']))
    Story.append(Paragraph("Project Overview", styles['CustomHeading2']))
    Story.append(Paragraph("PRISM is built to address the lack of deep, aggregated engineering intelligence in standard source control platforms.", styles['BodyTextCustom']))
    Story.append(Paragraph("Problem Statement", styles['CustomHeading2']))
    Story.append(Paragraph("Engineering managers struggle to get a holistic view of team velocity, identify review bottlenecks, and track CI/CD stability across multiple repositories.", styles['BodyTextCustom']))
    Story.append(Paragraph("Objectives", styles['CustomHeading2']))
    Story.append(Paragraph("- Provide actionable insights on PR cycle times.", styles['BodyTextCustom']))
    Story.append(Paragraph("- Track CI/CD flakiness and performance.", styles['BodyTextCustom']))
    Story.append(Paragraph("- Identify stale branches and forgotten issues.", styles['BodyTextCustom']))
    Story.append(Paragraph("Scope", styles['CustomHeading2']))
    Story.append(Paragraph("The system covers data ingestion via GitHub API, data persistence, analytics processing, and dashboard visualization.", styles['BodyTextCustom']))
    Story.append(PageBreak())

    # 7. Technology Stack
    Story.append(Paragraph("2. Technology Stack", styles['CustomHeading1']))
    Story.append(Paragraph("Frontend Technologies", styles['CustomHeading2']))
    Story.append(Paragraph("React 18, Next.js 14, Tailwind CSS, Recharts, Framer Motion.", styles['BodyTextCustom']))
    Story.append(Paragraph("Backend Technologies", styles['CustomHeading2']))
    Story.append(Paragraph("Python 3, FastAPI, SQLAlchemy, Uvicorn.", styles['BodyTextCustom']))
    Story.append(Paragraph("Database", styles['CustomHeading2']))
    Story.append(Paragraph("MySQL (via PyMySQL) for persistent relational storage.", styles['BodyTextCustom']))
    Story.append(PageBreak())

    # 8. Architecture
    Story.append(Paragraph("3. System Architecture", styles['CustomHeading1']))
    Story.append(Paragraph("The system follows a modern decoupled architecture. The Next.js frontend communicates with the FastAPI backend via REST APIs. The backend orchestrates data sync from GitHub APIs and stores structured data into MySQL.", styles['BodyTextCustom']))
    Story.append(Paragraph("Diagram Placeholder:", styles['BodyTextCustom']))
    Story.append(Spacer(1, 3*inch)) # Space for diagram
    Story.append(PageBreak())

    # 9. Folder Structure
    Story.append(Paragraph("4. Folder Structure Analysis", styles['CustomHeading1']))
    Story.append(Paragraph("backend/: Contains the FastAPI application, database models (database/), GitHub sync logic (github/), analytics engines (services/), and ML predictions (ml/).", styles['BodyTextCustom']))
    Story.append(Paragraph("frontend/: Contains the Next.js application, React components (components/), UI pages (app/), and global styles (globals.css).", styles['BodyTextCustom']))
    Story.append(PageBreak())

    # 10. Module Description
    Story.append(Paragraph("5. Module Description", styles['CustomHeading1']))
    modules = ["Dashboard", "Authentication", "Analytics", "GitHub Integration", "CI/CD Module", "Issues Module", "Forks & Discussions"]
    for mod in modules:
        Story.append(Paragraph(mod, styles['CustomHeading2']))
        Story.append(Paragraph(f"The {mod} module provides specialized functionality and data views for its domain, leveraging the analytics engine to deliver insights.", styles['BodyTextCustom']))
    Story.append(PageBreak())

    # 11. Database Design
    Story.append(Paragraph("6. Database Design", styles['CustomHeading1']))
    Story.append(Paragraph("The schema revolves around the Repository entity. Key tables include pull_requests, issues, branches, workflows, and forks.", styles['BodyTextCustom']))
    Story.append(Paragraph("Key Relationships: Repository -> 1:N -> PullRequests, Issues, Workflows.", styles['BodyTextCustom']))
    Story.append(PageBreak())

    # 12. API Documentation
    Story.append(Paragraph("7. API Documentation", styles['CustomHeading1']))
    Story.append(Paragraph("Key Endpoints:", styles['BodyTextCustom']))
    Story.append(Paragraph("- GET /api/repositories : List repositories", styles['BodyTextCustom']))
    Story.append(Paragraph("- GET /api/analytics/kpi/{repo_id} : Get core KPIs", styles['BodyTextCustom']))
    Story.append(Paragraph("- GET /api/export-pdf/{repo_id} : Export PDF report", styles['BodyTextCustom']))
    Story.append(PageBreak())

    # 13. UI/UX Screenshots
    Story.append(Paragraph("8. UI/UX Screenshots", styles['CustomHeading1']))
    
    img_paths = [
        ("Login Page", "d:/DM INTERN/final foldars/3/ss_login.png"),
        ("Dashboard", "d:/DM INTERN/final foldars/3/ss_dashboard.png"),
        ("API Docs", "d:/DM INTERN/final foldars/3/ss_apidocs.png"),
        ("Repositories", "d:/DM INTERN/final foldars/3/ss_repos.png")
    ]
    
    for title, path in img_paths:
        Story.append(Paragraph(title, styles['CustomHeading2']))
        if os.path.exists(path):
            # Try to add image
            try:
                img = Image(path, width=6*inch, height=3.5*inch)
                Story.append(img)
            except Exception as e:
                Story.append(Paragraph(f"[Image placeholder - Error loading {path}]", styles['BodyTextCustom']))
        else:
            Story.append(Paragraph(f"[Image placeholder - {path} not found]", styles['BodyTextCustom']))
        Story.append(Spacer(1, 0.5*inch))
    
    Story.append(PageBreak())

    # 14. Workflow and Execution
    Story.append(Paragraph("9. Workflow and Execution", styles['CustomHeading1']))
    Story.append(Paragraph("1. User logs in. 2. Repositories are fetched. 3. Sync engine pulls latest data. 4. Dashboard visualizes metrics.", styles['BodyTextCustom']))
    Story.append(PageBreak())

    # 15-22. Other Sections
    sections = [
        ("10. Features", "Rich dashboards, ML insights, comprehensive PR analytics, automated PDF reporting."),
        ("11. Security Features", "JWT authentication, route protection, environment variable secrets."),
        ("12. Performance Optimization", "Database indexing, backend data aggregation, React lazy loading."),
        ("13. Testing", "Unit tests for ML modules, manual testing for UI/UX flows."),
        ("14. Deployment", "Docker-ready, PM2 for Next.js, Uvicorn for FastAPI."),
        ("15. Challenges and Solutions", "Handling GitHub rate limits -> Solved via intelligent sync backoff and lightweight sync modes."),
        ("16. Future Enhancements", "WebSocket live updates, deep JIRA integration."),
        ("17. Conclusion", "PRISM effectively solves the visibility gap in software engineering workflows, offering a robust tool for managers."),
        ("18. References", "GitHub API Docs, FastAPI Docs, Next.js Docs, ReportLab Docs.")
    ]

    for title, content in sections:
        Story.append(Paragraph(title, styles['CustomHeading1']))
        Story.append(Paragraph(content, styles['BodyTextCustom']))
        Story.append(Spacer(1, 0.2*inch))
    
    Story.append(PageBreak())

    # 24. Appendix
    Story.append(Paragraph("19. Appendix", styles['CustomHeading1']))
    Story.append(Paragraph("Run Commands:", styles['CustomHeading2']))
    Story.append(Preformatted("Backend: uvicorn main:app --reload\nFrontend: npm run dev", styles['CodeStyle']))

    # Build the PDF
    doc.build(Story)
    print(f"Report generated at {output_filename}")

if __name__ == "__main__":
    out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "PROJECT_REPORT_FINAL.pdf")
    generate_report(out_path)
