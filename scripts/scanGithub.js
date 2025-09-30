#!/usr/bin/env node

/**
 * GitHub Scanner for ioBroker Adapter Repositories
 * 
 * This script scans GitHub for public repositories that might be ioBroker adapters.
 * It searches for repositories with names matching the "iobroker.*" pattern.
 */

const { Octokit } = require('@octokit/rest');
const fs = require('fs');
const path = require('path');

class GitHubScanner {
    constructor() {
        // Initialize Octokit with optional authentication
        // If GITHUB_TOKEN is provided, use it for higher rate limits
        this.octokit = new Octokit({
            auth: process.env.GITHUB_TOKEN || undefined
        });
        
        this.foundRepositories = [];
        this.jsonFilePath = path.join(__dirname, '..', 'ioBrokerRepositories.json');
        this.existingRepositories = this.loadExistingRepositories();
        
        // Cache for external repository data
        this.sourcesLatest = null;
        this.sourcesStable = null;
    }

    /**
     * Extract adapter name from repository full_name
     * @param {string} fullName - Repository full name (e.g., "ioBroker/ioBroker.admin")
     * @returns {string} - Adapter name (e.g., "admin")
     */
    extractAdapterName(fullName) {
        const repoName = fullName.split('/')[1] || '';
        
        // Remove "iobroker." prefix if present (case insensitive)
        if (repoName.toLowerCase().startsWith('iobroker.')) {
            return repoName.substring(9); // "iobroker.".length = 9
        }
        
        // For repositories not following the pattern, use the full repo name
        return repoName;
    }

    /**
     * Load sources_dist.json from iobroker/ioBroker.repositories
     */
    async loadSourcesLatest() {
        if (this.sourcesLatest) return this.sourcesLatest;
        
        try {
            console.log('📡 Loading sources-dist.json from iobroker/ioBroker.repositories...');
            const response = await this.octokit.rest.repos.getContent({
                owner: 'iobroker',
                repo: 'ioBroker.repositories',
                path: 'sources-dist.json'
            });
            
            const content = JSON.parse(Buffer.from(response.data.content, 'base64').toString());
            this.sourcesLatest = content;
            console.log(`✅ Loaded ${Object.keys(content).length - 1} adapters from sources-dist.json`); // -1 for _repoInfo
            return content;
        } catch (error) {
            console.warn(`⚠️  Error loading sources-dist.json: ${error.message}`);
            this.sourcesLatest = {};
            return {};
        }
    }

    /**
     * Load sources-dist-stable.json from iobroker/ioBroker.repositories
     */
    async loadSourcesStable() {
        if (this.sourcesStable) return this.sourcesStable;
        
        try {
            console.log('📡 Loading sources-dist-stable.json from iobroker/ioBroker.repositories...');
            const response = await this.octokit.rest.repos.getContent({
                owner: 'iobroker',
                repo: 'ioBroker.repositories',
                path: 'sources-dist-stable.json'
            });
            
            const content = JSON.parse(Buffer.from(response.data.content, 'base64').toString());
            this.sourcesStable = content;
            console.log(`✅ Loaded ${Object.keys(content).length - 1} adapters from sources-dist-stable.json`); // -1 for _repoInfo
            return content;
        } catch (error) {
            console.warn(`⚠️  Error loading sources-dist-stable.json: ${error.message}`);
            this.sourcesStable = {};
            return {};
        }
    }
    loadExistingRepositories() {
        try {
            if (fs.existsSync(this.jsonFilePath)) {
                const data = fs.readFileSync(this.jsonFilePath, 'utf8');
                const parsed = JSON.parse(data);
                console.log(`📄 Loaded ${Object.keys(parsed.repositories || {}).length} existing repositories from JSON file`);
                return parsed;
            }
        } catch (error) {
            console.warn(`⚠️  Error loading existing repositories: ${error.message}`);
        }
        
        return {
            lastUpdated: null,
            totalRepositories: 0,
            repositories: {}
        };
    }

    /**
     * Save repositories to JSON file
     */
    saveRepositoriesToJson(cleanup = false) {
        // If cleanup is enabled, remove invalid repositories
        if (cleanup) {
            const beforeCount = Object.keys(this.existingRepositories.repositories).length;
            const validRepositories = {};
            
            for (const [key, repo] of Object.entries(this.existingRepositories.repositories)) {
                if (repo.valid === true) {
                    validRepositories[key] = repo;
                }
            }
            
            this.existingRepositories.repositories = validRepositories;
            const removedCount = beforeCount - Object.keys(validRepositories).length;
            console.log(`🧹 Cleanup: Removed ${removedCount} invalid repositories from database`);
        }
        
        const data = {
            lastUpdated: new Date().toISOString(),
            totalRepositories: Object.keys(this.existingRepositories.repositories).length,
            scanSummary: {
                newRepositoriesFound: this.foundRepositories.length,
                searchStrategies: this.getSearchStrategies().map(s => s.description).join(', '),
                baseSearchQuery: process.env.SEARCH_QUERY || 'iobroker in:name',
                additionalQualifiers: process.env.ADDITIONAL_QUALIFIERS || ''
            },
            repositories: this.existingRepositories.repositories
        };

        try {
            fs.writeFileSync(this.jsonFilePath, JSON.stringify(data, null, 2));
            console.log(`✅ Saved repository data to ${this.jsonFilePath}`);
        } catch (error) {
            console.error(`❌ Error saving to JSON file: ${error.message}`);
            throw error;
        }
    }

    /**
     * Scan GitHub for repositories matching ioBroker adapter pattern
     */
    async scanForIoBrokerRepositories(cleanup = false) {
        console.log('🔍 Starting GitHub scan for ioBroker adapter repositories...\n');
        
        if (cleanup) {
            console.log('🧹 Cleanup mode enabled: Invalid repositories will be removed from database\n');
        }
        
        try {
            // Load external sources data
            const [sourcesLatest, sourcesStable] = await Promise.all([
                this.loadSourcesLatest(),
                this.loadSourcesStable()
            ]);
            
            // Mark all existing repositories as potentially invalid (we'll mark them valid if found)
            const existingRepoKeys = Object.keys(this.existingRepositories.repositories);
            existingRepoKeys.forEach(key => {
                this.existingRepositories.repositories[key].valid = false;
            });
            
            let newRepositoriesFound = 0;
            let updatedRepositories = 0;
            
            // Use multiple search strategies to work around the 1000-result limit
            const searchStrategies = this.getSearchStrategies();
            
            for (const strategy of searchStrategies) {
                console.log(`\n🔍 Using search strategy: ${strategy.description}`);
                console.log(`   Query: ${strategy.query}`);
                
                const strategyResults = await this.searchWithStrategy(strategy);
                
                for (const repo of strategyResults) {
                    // Filter for repositories that match ioBroker adapter pattern
                    if (await this.isLikelyIoBrokerAdapter(repo)) {
                        // Extract adapter name for checking against sources
                        const adapterName = this.extractAdapterName(repo.full_name);
                        
                        // Get the root repository for forked repos
                        const base = await this.getRootRepository(repo);
                        
                        const repoData = {
                            name: repo.name,
                            full_name: repo.full_name,
                            html_url: repo.html_url,
                            description: repo.description,
                            language: repo.language,
                            forks: repo.forks_count,
                            updated_at: repo.updated_at,
                            isForked: repo.fork || false,
                            isArchived: repo.archived || false,
                            base: base,
                            inLatest: this.checkInLatest(adapterName, repo.full_name, sourcesLatest),
                            inStable: this.checkInStable(adapterName, repo.full_name, sourcesStable),
                            valid: true,
                            lastScanned: new Date().toISOString()
                        };
                        
                        // Check if this is a new repository or an update
                        const repoKey = repo.full_name;
                        if (!this.existingRepositories.repositories[repoKey]) {
                            newRepositoriesFound++;
                            // console.log(`🆕 New repository found: ${repo.full_name}`);
                            this.foundRepositories.push(repoData);
                        } else {
                            updatedRepositories++;
                        }
                        
                        // Add or update repository
                        this.existingRepositories.repositories[repoKey] = repoData;
                    }
                }
                
                // Add delay between strategies to respect rate limits
                await this.delay(500);
            }
            
            // Count invalid repositories (ones that were not found in current scan)
            const invalidCount = existingRepoKeys.filter(key => 
                !this.existingRepositories.repositories[key].valid
            ).length;
            
            console.log(`\n✅ Scan completed!`);
            console.log(`   📊 New repositories found: ${newRepositoriesFound}`);
            console.log(`   🔄 Updated repositories: ${updatedRepositories}`);
            console.log(`   ❌ Repositories marked as invalid: ${invalidCount}`);
            console.log(`   📦 Total repositories in database: ${Object.keys(this.existingRepositories.repositories).length}\n`);
            
            // Save to JSON file
            this.saveRepositoriesToJson(cleanup);
            
            // Display results
            this.displayResults();
            
        } catch (error) {
            console.error('❌ Error during GitHub scan:', error.message);
            
            if (error.status === 403) {
                console.error('Rate limit exceeded. Consider setting GITHUB_TOKEN environment variable for higher limits.');
            }
            
            throw error;
        }
    }

    /**
     * Get search strategies based on year-by-year creation dates to work around GitHub's 1000-result limit
     */
    getSearchStrategies() {
        // Build base search query from environment variables or defaults
        const baseQuery = process.env.SEARCH_QUERY || 'iobroker in:name';
        const additionalQualifiers = process.env.ADDITIONAL_QUALIFIERS || '';
        
        // We need to search separately for:
        // 1. Non-archived, non-forked repositories
        // 2. Non-archived, forked repositories  
        // 3. Archived repositories (both forked and non-forked)
        const searchConfigurations = [
            { forkQualifier: 'fork:false', archivedQualifier: 'archived:false', description: 'non-archived non-forked' },
            { forkQualifier: 'fork:true', archivedQualifier: 'archived:false', description: 'non-archived forked' },
            { forkQualifier: 'fork:true', archivedQualifier: 'archived:true', description: 'archived forked' }
        ];
        
        const strategies = [];
        const currentYear = new Date().getFullYear();
        const startYear = 2014;
        
        // Generate year-based search strategies from current year down to 2014
        for (let year = currentYear; year >= startYear; year--) {
            // Search for each configuration
            for (const config of searchConfigurations) {
                const yearQuery = `${baseQuery} ${config.forkQualifier} ${config.archivedQualifier} created:${year}-01-01..${year}-12-31 ${additionalQualifiers}`.trim();
                strategies.push({
                    query: yearQuery,
                    description: `${config.description} repositories created in ${year}`,
                    year: year,
                    forkQualifier: config.forkQualifier,
                    archivedState: config.archivedQualifier,
                    needsMonthlyBreakdown: false // Will be set to true if we hit the 1000-result limit
                });
            }
        }
        
        return strategies;
    }

    /**
     * Search GitHub with a specific strategy, handling the 1000-result limit
     * If a year-based search hits the limit, it will automatically break down by months
     */
    async searchWithStrategy(strategy) {
        const repositories = [];
        let page = 1;
        let hasNextPage = true;
        const maxPages = 10; // GitHub limit: 1000 results / 100 per_page = 10 pages max
        
        while (hasNextPage && page <= maxPages) {
            try {
                console.log(`📄 Fetching page ${page}...`);
                
                const response = await this.octokit.rest.search.repos({
                    q: strategy.query,
                    sort: 'updated',
                    order: 'desc',
                    per_page: 100,
                    page: page
                });
                
                const pageRepositories = response.data.items;
                repositories.push(...pageRepositories);
                
                // Check if we have more pages (less than 100 results means last page)
                hasNextPage = pageRepositories.length === 100;
                page++;
                
                // Add a small delay to respect rate limits
                await this.delay(100);
                
            } catch (error) {
                if (error.status === 422 && error.message.includes('Only the first 1000 search results are available')) {
                    console.log(`⚠️  Reached GitHub's 1000-result limit for strategy: ${strategy.description}`);
                    
                    // If this is a year-based strategy and we hit the limit, break down by months
                    if (strategy.year && !strategy.isMonthly) {
                        console.log(`🔍 Breaking down ${strategy.year} search by months...`);
                        const monthlyResults = await this.searchYearByMonths(strategy);
                        // Return only monthly results as we've already collected some results that are incomplete
                        return monthlyResults;
                    }
                    break;
                } else {
                    // Re-throw other errors
                    throw error;
                }
            }
        }
        
        // Check if we hit exactly 1000 results (10 pages * 100 per page)
        // This means there might be more results but GitHub won't show them
        if (repositories.length === 1000 && strategy.year && !strategy.isMonthly) {
            console.log(`⚠️  Reached exactly 1000 results for strategy: ${strategy.description}`);
            console.log(`🔍 Breaking down ${strategy.year} search by months to ensure complete coverage...`);
            const monthlyResults = await this.searchYearByMonths(strategy);
            return monthlyResults;
        }
        
        console.log(`   Found ${repositories.length} repositories with this strategy`);
        return repositories;
    }

    /**
     * Search a specific year by breaking it down into months
     */
    async searchYearByMonths(yearStrategy) {
        const baseQuery = process.env.SEARCH_QUERY || 'iobroker in:name';
        const additionalQualifiers = process.env.ADDITIONAL_QUALIFIERS || '';
        const year = yearStrategy.year;
        const allRepositories = [];
        
        // Use the archived state and fork qualifier from the parent strategy
        const archivedQualifier = yearStrategy.archivedState || 'archived:false';
        const forkQualifier = yearStrategy.forkQualifier || 'fork:true';
        
        // Search each month of the year
        for (let month = 1; month <= 12; month++) {
            const monthStr = month.toString().padStart(2, '0');
            const startDate = `${year}-${monthStr}-01`;
            
            // Calculate end date (last day of month)
            const endDate = new Date(year, month, 0).toISOString().split('T')[0];
            
            const monthQuery = `${baseQuery} ${forkQualifier} ${archivedQualifier} created:${startDate}..${endDate} ${additionalQualifiers}`.trim();
            const monthStrategy = {
                query: monthQuery,
                description: `Repositories created in ${year}-${monthStr} (${forkQualifier} ${archivedQualifier})`,
                year: year,
                month: month,
                forkQualifier: forkQualifier,
                archivedState: archivedQualifier,
                isMonthly: true
            };
            
            console.log(`\n🔍 Searching month: ${monthStrategy.description}`);
            console.log(`   Query: ${monthStrategy.query}`);
            
            const monthResults = await this.searchWithStrategy(monthStrategy);
            allRepositories.push(...monthResults);
            
            // Add delay between months
            await this.delay(500);
        }
        
        return allRepositories;
    }

    /**
     * Check if a repository name matches the ioBroker.* pattern
     * @param {string} repoName - Repository name
     * @returns {boolean} - True if name matches ioBroker.* pattern (case-insensitive)
     */
    matchesIoBrokerPattern(repoName) {
        const name = repoName.toLowerCase();
        // Must match "iobroker." followed by something (not just "iobroker")
        return name.startsWith('iobroker.') && name.length > 9; // 9 = "iobroker.".length
    }

    /**
     * Check if a repository contains io-package.json file
     * @param {object} repo - Repository object
     * @returns {Promise<boolean>} - True if io-package.json exists
     */
    async hasIoPackageJson(repo) {
        try {
            await this.octokit.rest.repos.getContent({
                owner: repo.owner.login,
                repo: repo.name,
                path: 'io-package.json'
            });
            return true;
        } catch (error) {
            if (error.status === 404) {
                return false;
            }
            // For other errors (rate limit, etc), log warning but assume file might exist
            console.warn(`⚠️  Error checking io-package.json for ${repo.full_name}: ${error.message}`);
            return false;
        }
    }

    /**
     * Get the root/source repository by traversing the fork chain
     * @param {object} repo - Repository object
     * @returns {Promise<string|null>} - Full name of the root repository or null
     */
    async getRootRepository(repo) {
        if (!repo.fork) {
            // Not a fork, this is the root
            return repo.full_name;
        }
        
        try {
            // Get detailed repository info to access parent
            const { data: repoData } = await this.octokit.rest.repos.get({
                owner: repo.owner.login,
                repo: repo.name
            });
            
            if (!repoData.parent) {
                // No parent info available, return current repo
                return repo.full_name;
            }
            
            // Recursively traverse up the fork chain
            let currentRepo = repoData.parent;
            while (currentRepo.fork && currentRepo.parent) {
                const { data: parentData } = await this.octokit.rest.repos.get({
                    owner: currentRepo.owner.login,
                    repo: currentRepo.name
                });
                
                if (!parentData.parent) {
                    // This is the root
                    return parentData.full_name;
                }
                
                currentRepo = parentData.parent;
            }
            
            return currentRepo.full_name;
        } catch (error) {
            console.warn(`⚠️  Error getting root repository for ${repo.full_name}: ${error.message}`);
            return null;
        }
    }

    /**
     * Check if adapter is in sources-dist.json (latest) and meta references this repo
     * @param {string} adapterName - Adapter name
     * @param {string} repoFullName - Full name of the repository
     * @param {object} sourcesLatest - Sources dist data
     * @returns {boolean} - True if adapter is in latest and meta references this repo
     */
    checkInLatest(adapterName, repoFullName, sourcesLatest) {
        if (!sourcesLatest || !sourcesLatest[adapterName]) {
            return false;
        }
        
        const adapterEntry = sourcesLatest[adapterName];
        
        // Check if meta attribute references this repository's io-package.json
        if (adapterEntry.meta) {
            // Meta can be a full URL like: https://raw.githubusercontent.com/owner/repo/master/io-package.json
            // Extract owner/repo from the URL
            const metaMatch = adapterEntry.meta.match(/githubusercontent\.com\/([^\/]+\/[^\/]+)\//);
            if (metaMatch) {
                const metaRepo = metaMatch[1];
                return metaRepo.toLowerCase() === repoFullName.toLowerCase();
            }
        }
        
        return false;
    }

    /**
     * Check if adapter is in sources-dist-stable.json and meta references this repo
     * @param {string} adapterName - Adapter name
     * @param {string} repoFullName - Full name of the repository
     * @param {object} sourcesStable - Sources dist stable data
     * @returns {boolean} - True if adapter is in stable and meta references this repo
     */
    checkInStable(adapterName, repoFullName, sourcesStable) {
        if (!sourcesStable || !sourcesStable[adapterName]) {
            return false;
        }
        
        const adapterEntry = sourcesStable[adapterName];
        
        // Check if meta attribute references this repository's io-package.json
        if (adapterEntry.meta) {
            // Meta can be a full URL like: https://raw.githubusercontent.com/owner/repo/master/io-package.json
            // Extract owner/repo from the URL
            const metaMatch = adapterEntry.meta.match(/githubusercontent\.com\/([^\/]+\/[^\/]+)\//);
            if (metaMatch) {
                const metaRepo = metaMatch[1];
                return metaRepo.toLowerCase() === repoFullName.toLowerCase();
            }
        }
        
        return false;
    }

    /**
     * Check if a repository is likely an ioBroker adapter
     */
    async isLikelyIoBrokerAdapter(repo) {
        const name = repo.name.toLowerCase();
        
        // Primary check: name must match "ioBroker.*" pattern (case insensitive)
        if (!this.matchesIoBrokerPattern(repo.name)) {
            return false;
        }
        
        // Optimization: Skip io-package.json check if adapter is already listed with valid=true
        const existingRepo = this.existingRepositories.repositories[repo.full_name];
        if (existingRepo && existingRepo.valid === true) {
            // Already validated, no need to check again
            return true;
        }
        
        // Secondary check: must contain io-package.json file
        const hasIoPackage = await this.hasIoPackageJson(repo);
        if (!hasIoPackage) {
            console.log(`⚠️  Skipping ${repo.full_name} - missing io-package.json`);
            return false;
        }
        
        return true;
    }

    /**
     * Display scan results
     */
    displayResults() {
        const allRepositories = Object.values(this.existingRepositories.repositories);
        const validRepositories = allRepositories.filter(repo => repo.valid);
        const invalidRepositories = allRepositories.filter(repo => !repo.valid);
        
        if (allRepositories.length === 0) {
            console.log('No ioBroker adapter repositories found.');
            return;
        }

        console.log('📋 Repository Database Summary:');
        console.log('='.repeat(80));
        console.log(`📦 Total repositories: ${allRepositories.length}`);
        console.log(`✅ Valid repositories: ${validRepositories.length}`);
        console.log(`❌ Invalid repositories: ${invalidRepositories.length}`);
        console.log(`🆕 New repositories in this scan: ${this.foundRepositories.length}`);
        
        if (this.foundRepositories.length > 0) {
            console.log('\n🆕 New repositories found in this scan:');
            console.log('-'.repeat(80));
            
            this.foundRepositories.forEach((repo) => {
                console.log(`📦 ${repo.full_name}`);
                console.log(`   URL: ${repo.html_url}`);
                console.log(`   Description: ${repo.description || 'No description'}`);
                console.log(`   Language: ${repo.language || 'Unknown'}`);
                console.log(`   🍴 ${repo.forks} forks`);
                console.log(`   Updated: ${new Date(repo.updated_at).toLocaleDateString()}`);
                console.log(`   Forked: ${repo.isForked ? 'Yes' : 'No'}${repo.base ? ` (from ${repo.base})` : ''}`);
                console.log(`   Archived: ${repo.isArchived ? 'Yes' : 'No'}`);
                console.log(`   In Latest: ${repo.inLatest ? 'Yes' : 'No'}`);
                console.log(`   In Stable: ${repo.inStable ? 'Yes' : 'No'}`);
                console.log('-'.repeat(40));
            });
        }
        
        if (invalidRepositories.length > 0) {
            console.log('\n❌ Repositories marked as invalid (no longer found):');
            console.log('-'.repeat(80));
            
            invalidRepositories.forEach((repo) => {
                console.log(`📦 ${repo.full_name} (last seen: ${new Date(repo.lastScanned || repo.updated_at).toLocaleDateString()})`);
            });
        }
        
        // Summary statistics
        console.log(`\n📊 Database Statistics:`);
        console.log(`   Total repositories: ${allRepositories.length}`);
        
        const languages = {};
        validRepositories.forEach(repo => {
            const lang = repo.language || 'Unknown';
            languages[lang] = (languages[lang] || 0) + 1;
        });
        
        console.log(`   Languages (valid repos): ${Object.entries(languages).map(([lang, count]) => `${lang} (${count})`).join(', ')}`);
        
        console.log(`\n💾 Repository data saved to: ioBrokerRepositories.json`);
    }

    /**
     * Simple delay function
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Main execution
async function main() {
    // Parse command line arguments
    const args = process.argv.slice(2);
    const cleanup = args.includes('--cleanup');
    
    const scanner = new GitHubScanner();
    await scanner.scanForIoBrokerRepositories(cleanup);
}

// Run the scanner if this script is executed directly
if (require.main === module) {
    main().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

module.exports = GitHubScanner;
