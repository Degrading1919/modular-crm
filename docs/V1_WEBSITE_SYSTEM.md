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

1. owner enters hostname
2. system provides verification/DNS instruction
3. domain verification state tracked
4. certificate/hosting provider handles TLS in production
5. primary hostname selected
6. old/alternate hostnames redirect where supported

Infrastructure-specific domain provisioning belongs in a deployment/domain adapter.

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
