# watch-github
This repository watches github for ioBroker adapter repositories

## Overview

This repository contains an automated system for discovering and tracking ioBroker adapter repositories across GitHub. It maintains a persistent database of found repositories and tracks their status over time.

## Features

- **Automated Weekly Scans**: GitHub Actions workflow runs every Sunday at 2:00 AM UTC
- **Manual Triggering**: Can be triggered manually with custom search parameters
- **Persistent Database**: Maintains `ioBrokerRepositories.json` with all discovered repositories
- **Repository Tracking**: Never removes repositories, only marks them as invalid if no longer found
- **Flexible Search**: Supports custom search queries and additional qualifiers

## GitHub Actions Workflow

The workflow (`./github/workflows/scan-repositories.yml`) provides:

### Scheduled Execution
- Runs automatically every Sunday at 2:00 AM UTC
- Scans GitHub for ioBroker repositories and updates the database

### Manual Execution
Navigate to Actions → "Scan GitHub for ioBroker Repositories" → "Run workflow" with options:

- **Custom search query**: Override the default "iobroker in:name" search
- **Additional qualifiers**: Add search qualifiers like "language:javascript created:>2020"  
- **Dry run mode**: Test the scan without committing changes

### Workflow Features
- Automatically commits and pushes updates to `ioBrokerRepositories.json`
- Uploads scan results as workflow artifacts
- Handles authentication and rate limiting via `GITHUB_TOKEN`

## Scripts

### GitHub Scanner

The `scanGithub.js` script scans GitHub for repositories that might be ioBroker adapters.

#### Usage

```bash
# Install dependencies
npm install

# Run the scanner (basic usage)
npm run scan

# Run with custom search query
SEARCH_QUERY="iobroker in:name language:javascript" node scripts/scanGithub.js

# Run with additional qualifiers
SEARCH_QUERY="iobroker in:name" ADDITIONAL_QUALIFIERS="language:javascript" node scripts/scanGithub.js
```

#### Environment Variables

- `GITHUB_TOKEN` (recommended): GitHub personal access token for higher API rate limits
- `SEARCH_QUERY` (optional): Custom search query (default: "iobroker in:name")
- `ADDITIONAL_QUALIFIERS` (optional): Additional search qualifiers
- `DRY_RUN` (optional): Set to "true" to prevent JSON file updates

#### Features

- Scans all public repositories on GitHub
- Uses year-based search strategy with monthly fallback to work around GitHub's 1000-result limit
- Identifies repositories with names starting with "iobroker"
- Finds repositories with ioBroker-related descriptions and metadata
- Maintains persistent repository database
- Never removes existing repositories (marks as invalid instead)
- Provides detailed output with repository information
- Handles API rate limiting gracefully

#### GitHub API Limit Handling

The GitHub Search API has a hard limit of 1000 results per search query. To work around this limitation, the scanner uses a **year-based search strategy**:

1. **Year-by-year search**: Searches for repositories created in each year from current year down to 1990
2. **Monthly breakdown fallback**: If any year returns more than 1000 results, it automatically breaks down that year into monthly searches
3. **Comprehensive coverage**: Ensures all repositories matching the name requirements are discovered regardless of when they were created

This approach guarantees complete discovery of all matching repositories by systematically searching through creation date ranges, with automatic granular breakdown when needed.

## Repository Database

The `ioBrokerRepositories.json` file contains:

```json
{
  "lastUpdated": "2024-09-30T09:00:00.000Z",
  "totalRepositories": 150,
  "scanSummary": {
    "newRepositoriesFound": 3,
    "searchStrategies": "Primary search (most recent), Popular repositories (JavaScript), Active repositories, TypeScript repositories, Repositories with adapter in description",
    "baseSearchQuery": "iobroker in:name",
    "additionalQualifiers": ""
  },
  "repositories": {
    "ioBroker/ioBroker.admin": {
      "name": "ioBroker.admin",
      "full_name": "ioBroker/ioBroker.admin",
      "html_url": "https://github.com/ioBroker/ioBroker.admin",
      "description": "Admin interface for ioBroker",
      "language": "JavaScript", 
      "forks": 45,
      "updated_at": "2024-01-15T10:30:00Z",
      "isForked": false,
      "isArchived": false,
      "base": null,
      "inLatest": true,
      "inStable": true,
      "valid": true,
      "lastScanned": "2024-09-30T09:00:00.000Z"
    }
  }
}
```

### Repository Properties

- `valid`: `true` if found in latest scan, `false` if no longer exists
- `lastScanned`: Timestamp of when repository was last found
- `isForked`: `true` if repository is a fork, `false` otherwise
- `isArchived`: `true` if repository is archived, `false` otherwise  
- `base`: For forked repositories, the full name of the source repository (e.g., "owner/repo")
- `inLatest`: `true` if adapter is present in ioBroker's latest sources repository
- `inStable`: `true` if adapter is present in ioBroker's stable sources repository
- Standard GitHub repository metadata (forks, language, etc.)

## Output

The scanner displays:
- Repository name and URL
- Description and programming language
- Fork counts and repository status
- Last update date
- Fork status and source repository (if applicable)
- Archive status
- Presence in ioBroker latest/stable repositories
- Repository validity status
- Summary statistics including new/updated/invalid repositories
