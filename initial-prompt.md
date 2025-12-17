# OAuth Proxy for EEN 

## Overview
we are redeveloping a OAuth proxy hosted at Cloudflare, similar to the implementation found in
../een-login/cloudflare, but as standalone repository. 

The emphasis is on security and best practices for OAuth. 

The proxy will be used to authenticate with the EEN OAuth services, so that the CLIENT_ID is 
never shared with the front end. Access can be created and managed through the proxy API. 

The proxy should only accept request from specific domains, as shown in the example code. The
domains should be determined at deployment time and can not be changed through API calls to
the proxy itself.

### local version
We want to run a local version of the proxy using Cloudflares local development features. That 
version should also allow access from the localhost domain. 

### development
Use best practices for the development, and make sure it meets security standards.
The code for the proxy should be in a subfolder ./proxy
The version identifier in the package.json file should increment the patch by one with every commit.
You can use Husky for this. 
Use the latest stable packages for any package that is imported. 


### deployment 
Provide npm based scripts to deploy to cloudflare. Required credentials are in the .env file. 

### testing 
We are developing a comprehensive test suite for the Proxy.


## management application

There are some management APIs suchas "version" or "number of open sessions" or "remove sessions"
or possibly "revoke all tokens". Please build a small management application that allows to monitor 
the setting and trigger protective functions. Use VUE3 composition for that. Use a subdirectory 
for this application. This application will be deployed at Github pages.

The version is supposed to be the package.json version, plus the deployment time. 

The Admin functions should be only available to specific users that are authenticated through the 
EEN OAuth process, and through a specific port, which are determined at deployment time. The details 
should be stored in a .env file. 


## demo application

We also want to have a demo application that uses the OAuth Authentication without the overhead
of the management functions above. Create a separate subfolder for this. This should also use 
VUE3 composition API. 



## Q&A
  1. OAuth Flow: Which OAuth 2.0 flow should this proxy implement? (Authorization Code with PKCE, standard Authorization Code, or both?)
  We do the same thing as the example code. This is likely "Standard Authorization"

  2. EEN API Documentation: Do you have documentation for the EEN OAuth endpoints I should integrate with, or should I reference the existing ../een-login/cloudflare implementation?
  Please check out the relevant parts in ../een-login which is a VUE3 app that uses the example proxy

  3. Reference Code Access: Can I examine the existing implementation at ../een-login/cloudflare to understand the current patterns?
  Yes, the application can be used 

  4. Session Storage: For storing sessions/tokens on Cloudflare, which do you prefer?
    - Cloudflare KV (simple key-value, eventually consistent)
    - Durable Objects (strongly consistent, real-time)
    - D1 (SQLite database)

   Cloudflare KV seems sufficient. We do not expect to scale this beyond 100 parallel sessions. 
   But if there is a good reason to use a different solution we can consider it. Note that the current 
   cloudflare account is a "free tier" account.

  5. Session Data: What data should be stored per session? (access token, refresh token, expiry, user info?)
   We shold store what is needed for the requirements. 

  6. "Specific port" for admin: Could you clarify what you mean by admin access being through a "specific port"? Cloudflare Workers typically don't distinguish by port. Did you mean:
    - A separate Worker endpoint/route?
    - A different subdomain?
    - Something else?
   The "specific port" was referring to the port that the Cloudflare Proxy uses for the Admin API. But on second
   thought, this can be the same port that is used for other calls as long as there is protection regarding the 
   specific user that can execute the admin endpoints

  7. Admin Users: How should authorized admin users be identified? By EEN user ID, email, or some other identifier stored in .env?
  Admins can be identified by their email address. 

  8. Testing Framework: Do you have a preference for the test framework? (Vitest is common for Vue 3, and Cloudflare has its own testing utilities)
  VITEST seems appropriate. 

  9. Vue 3 Tooling: Should I use Vite as the build tool for the Vue applications?
    yes

  10. TypeScript: Should the entire codebase be in TypeScript, or is JavaScript acceptable?
    Typescript is OK, as well as Javascript.

  11. Subfolder Names: Any preferences for the subfolder names? I'm thinking:
    - ./proxy (as specified)
    - ./management or ./admin
    - ./demo
   We can use  ./admin and ./demo1 (there may be a a ./demo2). 
   You can possibly create three independent projects, i.e. each subfolder has it's own package.json.  
   If there is shared configuration data we can use ./env for this. The subfolders may have their own .env
   files, we want to minimize dependencies 
   There should be a ./README.md covering the overall project. 


## more questions

  Architecture Questions

  1. Admin Email Verification: The current implementation only verifies that a session exists for admin endpoints. You want to add email-based admin verification. Should the admin check:
    - Fetch user profile from EEN API using their access token, then verify email matches .env allowlist?
    - Or store the user's email in KV alongside the session?
   We need to store the admin emails within the proxy, but should make sure that this user authenticates with
   EEN, and has a valid access token. 

  2. Husky Version Bump: Should the auto-increment happen:
    - At the root level only (monorepo style)?
    - In each subfolder's package.json independently?
    - Only for the ./proxy package?
  Track versions for each sub-folder separately.

  3. GitHub Pages URL: For the management app deployment, what will the GitHub Pages URL be? (e.g., https://klaushofrichter.github.io/een-oauth-proxy/admin/)
   The current plan is to use https://klaushofrichter.github.io/een-oauth-proxy/admin   and use 
   https://klaushofrichter.github.io/een-oauth-proxy/demo1  for the demo1 application, if that is technically 
   possible for Github pages.  Please let me know if it is better to use separate repositories. 

  4. Allowed Origins: Should these be:
    - Environment variables (set at deploy time via .env)?
    - Hardcoded in wrangler.toml?
    - The existing code has them hardcoded in the worker source.
  We use .env when possible

  5. Cloudflare Account: You mentioned a free tier account. Do you already have a KV namespace ID to use, or should I create a new one during setup?
  you can create a KV namespace, and store in wrangler.toml 

  6. Worker Name/Domain: What should the Cloudflare Worker be named? (e.g., een-oauth-proxy → een-oauth-proxy.klaushofrichter.workers.dev)
  it is ok to use the propsoed name

  7. Demo App Scope: Should demo1 be a minimal "login and show user profile" app, or should it have more features like camera viewing from the existing een-login app?
  The demo app should show the user profile to prove that the EEN API can be accessed.
    You can see the app ../een-login/src/views/Profile.vue as example.
  The demo app should have an opportunity to login with the access token alone. See
    ../een-login/src/views/Direct.vue as example. 
  It should have a button to refresh the access token
  It should have a button to revoke the access token and the refresh token.
  It should show the validity time of the access token
  It should automatically refresh the access token some time before it expires. 
  
  8. Demo App Deployment: Where will demo1 be deployed? Also GitHub Pages?
   Yes, it should be deployed in Github pages. If needed, we can create a separate repository for the demo app

