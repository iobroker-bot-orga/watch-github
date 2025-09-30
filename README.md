# watch-github
This repository watches github for ioBroker adapter repositories

## Scripts

### GitHub Scanner

The `scanGithub.js` script scans GitHub for repositories that might be ioBroker adapters.

#### Usage

```bash
# Install dependencies
npm install

# Run the scanner
npm run scan
```

#### Environment Variables

- `GITHUB_TOKEN` (optional): GitHub personal access token for higher API rate limits

#### Features

- Scans all public repositories on GitHub
- Identifies repositories with names starting with "iobroker"
- Finds repositories with ioBroker-related descriptions and topics
- Provides detailed output with repository information
- Handles API rate limiting gracefully

#### Output

The scanner displays:
- Repository name and URL
- Description
- Programming language
- Star and fork counts
- Last update date
- Topics/tags
- Summary statistics
