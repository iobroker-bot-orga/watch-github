#!/usr/bin/env node

/**
 * GitHub Scanner for ioBroker Adapter Repositories
 * 
 * This script scans GitHub for public repositories that might be ioBroker adapters.
 * It searches for repositories with names matching the "iobroker.*" pattern.
 */

const { Octokit } = require('@octokit/rest');

class GitHubScanner {
    constructor() {
        // Initialize Octokit with optional authentication
        // If GITHUB_TOKEN is provided, use it for higher rate limits
        this.octokit = new Octokit({
            auth: process.env.GITHUB_TOKEN || undefined
        });
        
        this.foundRepositories = [];
    }

    /**
     * Scan GitHub for repositories matching ioBroker adapter pattern
     */
    async scanForIoBrokerRepositories() {
        console.log('🔍 Starting GitHub scan for ioBroker adapter repositories...\n');
        
        try {
            // Search for repositories with "iobroker" in the name
            const searchQuery = 'iobroker in:name';
            
            console.log(`Searching for: ${searchQuery}`);
            
            let page = 1;
            let hasNextPage = true;
            
            while (hasNextPage) {
                console.log(`📄 Fetching page ${page}...`);
                
                const response = await this.octokit.rest.search.repos({
                    q: searchQuery,
                    sort: 'updated',
                    order: 'desc',
                    per_page: 100,
                    page: page
                });
                
                const repositories = response.data.items;
                
                for (const repo of repositories) {
                    // Filter for repositories that match ioBroker adapter pattern
                    if (this.isLikelyIoBrokerAdapter(repo)) {
                        this.foundRepositories.push({
                            name: repo.name,
                            full_name: repo.full_name,
                            html_url: repo.html_url,
                            description: repo.description,
                            language: repo.language,
                            stars: repo.stargazers_count,
                            forks: repo.forks_count,
                            updated_at: repo.updated_at,
                            topics: repo.topics || []
                        });
                    }
                }
                
                // Check if we have more pages
                hasNextPage = repositories.length === 100;
                page++;
                
                // Add a small delay to respect rate limits
                await this.delay(100);
            }
            
            console.log(`\n✅ Scan completed! Found ${this.foundRepositories.length} potential ioBroker adapter repositories.\n`);
            
            // Display results
            this.displayResults();
            
        } catch (error) {
            console.error('❌ Error during GitHub scan:', error.message);
            
            if (error.status === 403) {
                console.error('Rate limit exceeded. Consider setting GITHUB_TOKEN environment variable for higher limits.');
            }
        }
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
        if (this.foundRepositories.length === 0) {
            console.log('No ioBroker adapter repositories found.');
            return;
        }

        console.log('📋 Found repositories:');
        console.log('='.repeat(80));
        
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
            console.log('-'.repeat(80));
        });
        
        // Summary
        console.log(`\n📊 Summary:`);
        console.log(`   Total repositories found: ${this.foundRepositories.length}`);
        
        const languages = {};
        this.foundRepositories.forEach(repo => {
            const lang = repo.language || 'Unknown';
            languages[lang] = (languages[lang] || 0) + 1;
        });
        
        console.log(`   Languages: ${Object.entries(languages).map(([lang, count]) => `${lang} (${count})`).join(', ')}`);
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