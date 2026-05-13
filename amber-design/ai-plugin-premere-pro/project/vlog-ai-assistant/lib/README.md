# lib/ - External Libraries

This directory is for external JavaScript libraries and dependencies that cannot be managed via npm due to UXP sandbox limitations.

## Usage

Place any third-party libraries here. Import them in HTML before your main scripts:

\\\html
<script src=\"lib/some-library.js\"></script>
<script src=\"js/index.js\"></script>
\\\

## Recommendations

**Prefer Built-in Solutions**: UXP has limited module support, so:
- Use native JavaScript (ES6+) where possible
- Use only proven, minimal libraries
- Keep library count low (performance impact)

**Candidates for lib/**:
- Date/time utilities (e.g., date-fns)
- Data validation libraries
- JSON parsing helpers
- Basic math/utility functions

**Avoid Adding:**
- Heavy frameworks
- DOM libraries (UXP has Spectrum)
- Build system dependencies
- Large polyfills

## Example Structure

\\\
lib/
├── README.md
├── date-utils.js
└── xml-builder.js
\\\

See [README.md](../README.md) for project structure documentation.
