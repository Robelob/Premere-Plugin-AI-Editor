# Project: Premiere AI Assistant

## Goal
An AI-powered UXP plugin to automate vlog editing (silence removal, B-roll, captions) 
directly within the Premiere Pro timeline.

## Tech Stack
- Frontend: UXP (HTML/CSS/Spectrum)
- Backend Logic: ExtendScript/JavaScript (Premiere DOM API)
- AI Logic: [Insert Chosen Free API, e.g., Gemini Flash API]

## Roadmap
- [ ] Phase 1: Project Skeleton (Basic UI Panel in Premiere)
- [ ] Phase 2: Metadata Extraction (Reading Project Bin/Timeline)
- [ ] Phase 3: AI Orchestration (Sending context to API)
- [ ] Phase 4: XML Implementation (Applying edits)

## Coding Standards (For Copilot)
- Use standard JS/ExtendScript conventions for Premiere API.
- Always check if `app.project.activeSequence` exists before running commands.
- Prioritize native Premiere features (e.g., call `app.enableClip()` or internal captioning tools) 
  before trying to recreate functionality manually.

  vlog-ai-assistant/
├── manifest.json          # Plugin metadata
├── README.md              # Documentation
├── plan.md                # Project tracker for you and Copilot
├── index.html             # Main entry point for the Panel UI
├── assets/                # Icons and images
│   ├── icon@1x.png
│   └── icon@2x.png
├── css/                   # Spectrum UXP styles
│   └── main.css
├── js/                    # Logic Layer
│   ├── main.js            # Initializes UI and event listeners
│   ├── premiere-api.js    # Interacts with Premiere Pro DOM
│   └── ai-service.js      # Handles communication with Gemini API
└── lib/                   # Any external helper libraries (if needed)