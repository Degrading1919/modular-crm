# V1 Website System Specification

## Goal

Give a small business a professional, functional website as part of CRM setup without becoming a general-purpose visual web builder.

## Architecture

A site is rendered from:

- template
- structured SiteContent
- business/branding data
- service catalog
- service areas
- public pricing policy
- enabled sections
- forms

Website content is not generated as arbitrary source code per tenant.

## Site content schema

Core fields:

- business_name
- tagline
- short_description
- long_description
- logo
- brand tokens
- business phone/email
- service area summary
- hours
- social links
- testimonials
- FAQ entries
- hero image/gallery
- legal/footer content
- SEO title/description
- section ordering/enabled state

Service information and pricing reference canonical CRM service/pricing data where practical rather than duplicated text.

## Templates

V1 ships with a small number of polished responsive templates.

Requirements:

- mobile-first
- accessible semantic markup
- fast load
- local business conversion oriented
- configurable branding
- Industry Pack content defaults
- no arbitrary tenant JavaScript
- forms integrated with CRM
- reusable section components

## Supported sections

- hero
- service overview
- individual services
- pricing/instant quote
- how it works
- service area
- testimonials
- FAQs
- gallery
- call to action
- request service
- booking
- contact
- customer login

Industry Packs may recommend defaults.

## Editing

Use structured controls:

- inline text fields
- section on/off
- section reorder
- choose template
- choose images
- service visibility
- public pricing visibility
- form behavior
- preview

No drag-anywhere canvas is needed.

## AI assistant

Optional AI onboarding assistant may:

- ask conversational questions
- propose tagline/descriptions/FAQs
- transform owner notes into structured content
- suggest missing fields

It must output a validated SiteContent schema.

Owner can edit/approve content.

A mock AI connector produces deterministic sample content locally.

## Publishing

States:

- draft
- published
- disabled

Preview:

- authenticated unpublished preview URL
- responsive preview sizes

Publish:

- renders current structured content
- updates published version atomically
- records audit event

## Domains

Every published site supports a platform hostname.

Custom domain flow:

1. Owner chooses **Use my own domain** and enters a bare hostname.
2. Copy the exact ownership TXT, website routing and certificate validation records shown by the configured provider.
3. **Check now** independently checks ownership and routing. The worker sets up and renews HTTPS without per-owner infrastructure edits.
4. Distinguish **Waiting for DNS**, **Verified**, **Secure connection being set up**, **Live** and **Needs attention**, with a specific record/certificate problem.
5. Only a fresh live domain can become primary; removing it restores the included address. Other verified addresses continue to serve the same site; a canonical redirect is not implemented in this slice.
6. Periodic rechecks stop routing when evidence is lost, checks are unavailable/stale or the site is unpublished/disabled. Unknown hosts never fall through to the staff application.

Infrastructure-specific domain provisioning belongs in a deployment/domain adapter.

### Owner help: connect your address

In Website, choose **Use my own domain**. Connecting `www.yourbusiness.com` is usually easiest. Copy each **Name / Host** and **Value / Target** into your domain provider: GoDaddy/Namecheap call the first field Host or Name, Cloudflare calls it Name (choose DNS only), and Route 53 calls it Record name. Some providers append your domain automatically; use only the part before it, or `@` for the root. Leave email records unchanged.

For the root address, your provider must support ALIAS, ANAME or CNAME flattening; do not copy a guessed IP address. Otherwise connect www and use the provider's root-to-www forwarding. Choose **Check now** after saving. Changes can take minutes or up to 48 hours; **Verified** does not yet mean the secure connection is ready. Once **Live**, you can visit it or make it primary. Keep the records for renewal. If a record points elsewhere, copy the displayed value again; if a secure-connection problem persists, contact support. Migrating an existing website can briefly interrupt it while the new connection is issued—plan a cutover, or keep its old address until ready. Your included website address remains available.

## Forms

Form types:

- contact
- request service
- instant quote/signup
- booking request

All forms:

- server validated
- tenant/site scoped
- rate limited
- bot/spam protection interface
- idempotent submission
- terms/consent capture when relevant
- create linked CRM objects

## Instant quote/signup

Industry Pack defines:

- fields to collect
- eligibility requirements
- pricing inputs
- portal/account behavior
- downstream workflow

Pet Waste Removal reference is defined in its pack document.

## SEO/local basics

V1 supports:

- page title/description
- canonical host
- sitemap
- robots control
- social metadata
- LocalBusiness structured data from business profile where valid
- service-area content
- accessible image alt text

Do not create mass-generated doorway/location pages automatically.

## Analytics

Site may expose a simple analytics adapter/event interface for:

- page view
- form started
- form submitted
- signup completed
- quote shown
- portal login click

A specific analytics vendor is optional.

## Customer chat

The architecture may reserve a website chat capability, but a live omnichannel conversation inbox is not required in V1.

If AI/site chat is enabled later, it should create or link CRM leads/tickets and respect tenant-defined knowledge/actions.

## Security

- tenant content is escaped/rendered safely
- no arbitrary HTML/JS by default
- uploads use protected validation and safe public publication rules
- public forms never expose connector secrets
- secure payment collection uses payment-provider hosted/elements mechanisms
