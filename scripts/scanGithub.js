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
    }

    /**
     * Load existing repositories from JSON file
     */
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
    saveRepositoriesToJson() {
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
    async scanForIoBrokerRepositories() {
        console.log('🔍 Starting GitHub scan for ioBroker adapter repositories...\n');
        
        try {
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
                    if (this.isLikelyIoBrokerAdapter(repo)) {
                        const repoData = {
                            name: repo.name,
                            full_name: repo.full_name,
                            html_url: repo.html_url,
                            description: repo.description,
                            language: repo.language,
                            stars: repo.stargazers_count,
                            forks: repo.forks_count,
                            updated_at: repo.updated_at,
                            topics: repo.topics || [],
                            valid: true,
                            lastScanned: new Date().toISOString()
                        };
                        
                        // Check if this is a new repository or an update
                        const repoKey = repo.full_name;
                        if (!this.existingRepositories.repositories[repoKey]) {
                            newRepositoriesFound++;
                            console.log(`🆕 New repository found: ${repo.full_name}`);
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
            this.saveRepositoriesToJson();
            
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
     * Get search strategies to work around GitHub's 1000-result limit
     */
    getSearchStrategies() {
        // Build base search query from environment variables or defaults
        const baseQuery = process.env.SEARCH_QUERY || 'iobroker in:name';
        const additionalQualifiers = process.env.ADDITIONAL_QUALIFIERS || '';
        
        const strategies = [
            {
                query: `${baseQuery} ${additionalQualifiers}`.trim(),
                description: 'Primary search (most recent)'
            },
            {
                query: `${baseQuery} stars:>10 ${additionalQualifiers}`.trim(),
                description: 'Popular repositories (>10 stars)'
            },
            {
                query: `${baseQuery} stars:>1 ${additionalQualifiers}`.trim(),
                description: 'Active repositories (>1 star)'
            },
            {
                query: `${baseQuery} language:javascript ${additionalQualifiers}`.trim(),
                description: 'JavaScript repositories'
            },
            {
                query: `${baseQuery} language:typescript ${additionalQualifiers}`.trim(),
                description: 'TypeScript repositories'
            },
            {
                query: `iobroker adapter in:description ${additionalQualifiers}`.trim(),
                description: 'Repositories with "adapter" in description'
            }
        ];
        
        // Remove duplicates and empty queries
        const uniqueStrategies = strategies.filter((strategy, index, arr) => 
            strategy.query.trim() && 
            arr.findIndex(s => s.query === strategy.query) === index
        );
        
        return uniqueStrategies;
    }

    /**
     * Search GitHub with a specific strategy, handling the 1000-result limit
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
                    break;
                } else {
                    // Re-throw other errors
                    throw error;
                }
            }
        }
        
        console.log(`   Found ${repositories.length} repositories with this strategy`);
        return repositories;
    }

    /**
     * Check if a repository is likely an ioBroker adapter
     */
    isLikelyIoBrokerAdapter(repo) {
        const name = repo.name.toLowerCase();
        const description = (repo.description || '').toLowerCase();
        
        // Primary check: name starts with "iobroker"
        if (name.startsWith('iobroker')) {
            return true;
        }
        
        // Secondary check: description mentions ioBroker AND it's likely an adapter
        if (description.includes('iobroker') && 
            (description.includes('adapter') || description.includes('integration'))) {
            return true;
        }
        
        // Check topics for iobroker AND adapter keywords together
        const topics = repo.topics || [];
        const hasIoBrokerTopic = topics.some(topic => topic.includes('iobroker'));
        const hasAdapterTopic = topics.some(topic => topic.includes('adapter'));
        
        if (hasIoBrokerTopic && hasAdapterTopic) {
            return true;
        }
        
        return false;
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
                console.log(`   ⭐ ${repo.stars} stars | 🍴 ${repo.forks} forks`);
                console.log(`   Updated: ${new Date(repo.updated_at).toLocaleDateString()}`);
                if (repo.topics.length > 0) {
                    console.log(`   Topics: ${repo.topics.join(', ')}`);
                }
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
    const scanner = new GitHubScanner();
    await scanner.scanForIoBrokerRepositories();
}

// Run the scanner if this script is executed directly
if (require.main === module) {
    main().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

module.exports = GitHubScanner;