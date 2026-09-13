# Deployment notes

The Sites project uses an intentionally empty private tunnel binding set.

The application reaches the Astra backend through the server-side
`LYRA_PUBLIC_GATEWAY_URL`, which is a public Funnel URL. The application has no
`CUSTOMER_HTTP_*` tunnel binding dependency. Do not re-attach a private tunnel
binding during a future publish unless the architecture and project permissions
are deliberately changed.

The public production domain is `https://epistack.adityaarpitha.com`.
