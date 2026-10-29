# LinkedIn Similar Companies | Lookalikes

**Turn one LinkedIn company URL into the similar companies shown on that page, with name, description, location, and URL. $1 per 1,000 source companies.** Starting from $0.45 per 1,000
## If you need a different Mawsool Actor

| If this is what you need | Open |
| --- | --- |
| Your LinkedIn URLs are old, stale, or no longer open. | [Fix Broken LinkedIn URLs](https://apify.com/oday/mawsool-fix-broken-linkedin-urls) |
| You have an email and want the LinkedIn profile. | [Reverse Email Lookup](https://apify.com/oday/mawsool-email-linkedin-lookup) |
| You have a name and company and want the profile URL. | [LinkedIn Profile Finder](https://apify.com/oday/mawsool-linkedin-profile-finder) |
| You have a profile URL and want the personal email. | [LinkedIn Email Finder](https://apify.com/oday/mawsool-linkedin-personal-email-finder) |
| You only need the current employer, before paying for a full profile. | [Current Company Checker](https://apify.com/oday/mawsool-linkedin-company-checker) |
| You want the current company and headline, and you will compare them to your CRM yourself. | [Profile Freshness Check](https://apify.com/oday/mawsool-linkedin-profile-freshness) |
| You want an alert when the employer or headline changes. | [Job Change Tracker](https://apify.com/oday/mawsool-linkedin-job-change-watch) |
| You have a profile URL and want the full profile. | [LinkedIn Profile Scraper](https://apify.com/oday/mawsool-linkedin-profile-details) |
| You have a large file of profile URLs. | [Mass Profile Scraper](https://apify.com/oday/mawsool-mass-linkedin-profile-scraper) |
| You want the current employer's website from a profile URL. | [Profile to Company Website](https://apify.com/oday/mawsool-linkedin-profile-to-company-website) |
| You want the job history only. | [Work Experience](https://apify.com/oday/mawsool-linkedin-profile-experience) |
| You want schools and degrees only. | [Education](https://apify.com/oday/mawsool-linkedin-profile-education) |
| You want a yes or no for one certificate. | [Certification Checker](https://apify.com/oday/mawsool-linkedin-certification-checker) |
| You want certificates, patents, courses, and publications. | [Certifications and Patents](https://apify.com/oday/mawsool-linkedin-profile-credentials) |
| You want likes and comments for outreach. | [Profile Activity](https://apify.com/oday/mawsool-linkedin-profile-activity) |
| You have a company URL and want the full company record. | [Company Details](https://apify.com/oday/mawsool-linkedin-company-details) |
| You have a large file of company URLs. | [Mass Company Scraper](https://apify.com/oday/mawsool-mass-linkedin-company-scraper) |
| You want the website, industry, and employee range. | [Firmographics and Website](https://apify.com/oday/mawsool-linkedin-company-firmographics) |
| You want office addresses. | [Company Locations](https://apify.com/oday/mawsool-linkedin-company-locations) |
| You want the recent posts on a company page. | [Company Posts](https://apify.com/oday/mawsool-linkedin-company-posts) |
| You want only new posts on the next scheduled run. | [Company Post Monitor](https://apify.com/oday/mawsool-linkedin-company-post-watch) |

The same list is on [Mawsool's Apify profile](https://apify.com/oday).

## Use with AI agents

Apify exposes this Actor to ChatGPT, Claude, Gemini, Grok, and other agents through the Apify MCP server. Tell the agent the input you have, the fields you want back, and the starting price on this page. If you already have profile URLs and only need the current company and headline, use [Profile Freshness Check](https://apify.com/oday/mawsool-linkedin-profile-freshness) first and compare the result to your CRM yourself.

 A visitor who starts on one Actor can open the rest from that page.


A page usually returns about 10 lookalikes. One source company is one charge. Send those URLs to [Company Details](https://apify.com/oday/mawsool-linkedin-company-details) or Company website and firmographics when you need the website and headcount.

This is the similar-companies block on the company page. It is not a custom lookalike model.

## Who is this for?

Outbound teams building a lookalike account list from a handful of customers.

## What does a row look like?

```json
{
  "inputUrl": "https://www.linkedin.com/company/example",
  "companyName": "Example",
  "similarCount": 10,
  "similarName": "Lookalike Co",
  "similarUrl": "https://www.linkedin.com/company/lookalike",
  "subtitle": "Software Development",
  "location": "United States",
  "success": true
}
```

## FAQ

### How many companies do I get?

Usually about 10 per source company. The count is whatever that page shows.

### Is one lookalike one charge?

No. The source company is one charge. The lookalike rows are included.

## Related Actors

Company website and firmographics for website, industry, and size. [Company Details](https://apify.com/oday/mawsool-linkedin-company-details) for the full page.
