# Rate limiting

Calls to our GraphQL API are rate limited to provide equitable access to the API for everyone and to prevent abuse. We are going to be evolving these limits as we gather more information, and encourage your feedback. Any changes to limits will be announced in our Slack community [API announcements channel](https://linearcustomers.slack.com/archives/CN61HRZ9T).

We use the [leaky bucket](https://en.wikipedia.org/wiki/Leaky_bucket) algorithm for our rate limiters, which means that your tokens are refilled with a constant rate of `LIMIT_AMOUNT / LIMIT_PERIOD`.

> [!NOTE]
> If you temporarily require higher limits, you can request them by contacting Linear support where we'll review them on a case by case basis.

## Avoiding hitting limits

These are best practices for using our APIs that will, in most cases, avoid hitting any rate limits.

### Avoid polling

One thing that we especially discourage is polling the API to fetch updates. If you need to know when data updates in Linear, you should use our [Webhook](https://linear.app/developers/webhooks) functionality.

### Avoid fetching unneeded data

Avoid fetching data you don't need by using our [filtering](https://linear.app/developers/filtering) functionality. This way you can drill down on specific records only and avoid pagination in some cases.

Keep in mind that by default our [pagination](https://linear.app/developers/pagination) returns up to 50 records. When querying for children this can quickly multiply the requested complexity. Consider specifying the amount of records you want returned.

### Order data

In certain cases where you do need to fetch all data, we suggest sorting it by the updated timestamp instead of when it was created. This way you can get the most recently changed data first, and avoid paginating through the entire dataset.

### Write custom, specific queries

This applies especially if you're using our SDK. If you're fetching lots of different entities or dependencies, or have specific data needs, it's always recommended to write your own custom GraphQL queries and use filters to narrow down the data as much as possible.

## API request limits

We limit the amount of requests you make to our GraphQL API. To make it easier to keep track and avoid going over the limits, there are 3 HTTP response headers we send back on each request.

HTTP Header | Description
--- | ---
`X-RateLimit-Requests-Limit` | The maximum number of API requests you're permitted to make per hour.
`X-RateLimit-Requests-Remaining` | The number of API requests remaining in the current rate limit window.
`X-RateLimit-Requests-Reset` | The time at which the current rate limit window resets in [UTC epoch milliseconds](https://en.wikipedia.org/wiki/Unix_time).

When authenticated using an API key you can make up to **5,000 requests per hour**. Requests are associated with the authenticated user, which means all requests by the same user share the same quota even when using different API keys.

When making unauthenticated requests, you are limited to **60 requests per hour**. These requests are associated with the originating IP address instead of the user making the request.

Authentication | Limit | per | Period
--- | --- | --- | ---
API key | 5,000 | User | 1 hour
OAuth App | 5,000 | User (or App User) | 1 hour
Unauthenticated | 60 | IP Address | 1 hour

### Query- and mutation- specific request limits

Some queries and mutations have individual request rate limits that are lower than the global request limit. When one of these limits is hit, the Linear API will send the same response as described in [Handling rate limited errors](https://linear.app/developers/rate-limiting#handling-rate-limit-errors). The window for each endpoint can be different, and is described in the response body. We will also send these extra headers:

HTTP Header | Description
--- | ---
`X-RateLimit-Endpoint-Requests-Limit` | The maximum number of API requests you're permitted to make to this endpoint in a rate limit window.
`X-RateLimit-Endpoint-Requests-Remaining` | The number of API requests remaining in the current rate limit window.
`X-RateLimit-Endpoint-Requests-Reset` | The time at which the current rate limit window resets in [UTC epoch milliseconds](https://en.wikipedia.org/wiki/Unix_time).
`X-RateLimit-Endpoint-Name` | The name of the endpoint that was rate limited.

### Complexity limits

In order to protect our system from queries that are too complex and resource intensive, we calculate the complexity of each query, based on the amount of requested data.

To make it easier to keep track and avoid going over the limits, there are 4 HTTP response headers we send back on each request.

HTTP Header | Description
--- | ---
`X-Complexity` | The complexity of the query.
`X-RateLimit-Complexity-Limit` | The maximum number of API complexity points you're permitted to request per hour.
`X-RateLimit-Complexity-Remaining` | The number of points of API request complexity remaining in the current rate limit window.
`X-RateLimit-Complexity-Reset` | The time at which the current rate limit window resets in [UTC epoch milliseconds](https://en.wikipedia.org/wiki/Unix_time).

Requests authenticated using an API key can request up to **250,000 points per hour**. Requests are associated with the authenticated user, which means all requests by the same user share the same quota even when using different API keys.

Unauthenticated requests are limited to **10,000 points per hour**. These requests are associated with the originating IP address instead of the user making the request.

Authentication | Limit | Per | Period
--- | --- | --- | ---
API key | 3,000,000 | User | 1 hour
OAuth app | 2,000,000 | User (or App User) | 1 hour
Unauthenticated | 10,000 | IP Address | 1 hour

#### Maximum complexity

We also enforce a maximum complexity of a single query at any time to **10,000 points**. Your query will always get rejected if it exceeds that.

#### Understanding query complexity

In order to protect our systems from too complex and resource intensive queries, we calculate the complexity of each query. Each property is 0.1 point, each object is 1 point and any connection multiplies its children's points based on the given pagination argument, or the default 50. The score is then rounded up to the nearest integer.

As an example, let's fetch an object that returns only one user and request only one property. The calculation is `1 + 0.1 = 1.1`, which equals a **complexity of 2** when rounded up.

```graphql
query WhoAmI {
  user(id: "me") {
    name
  }
}
```

Let's now fetch all of our created issue's ID, title and when they were created. This has a **complexity of 66**. Here's why:

Query | Complexity
--- | ---
`user` | 1 point
`createdIssues` (assuming 50, the default pagination) | 50 points
`id`, `title`, `createdAt` | 15 points (50 × 3 × 0.1)

You can use pagination parameters to specify a different limit than the default 50 to let the complexity calculator know how much data you're trying to fetch. This query with an explicit limit of the first 10 nodes then has a **complexity of 14**.

```graphql
query MyCreatedIssues {
  user(id: "me") {
    createdIssues(first: 10) {
      nodes {
        id
        title
        createdAt
      }
    }
  }
}
```

### Dynamic rate limits

We dynamically increase rate limits for workspace level OAuth apps using [Actor Authorization](https://linear.app/developers/oauth-actor-authorization) based on number of paid users in that workspace.

## Handling rate limit errors

Once you actually exceed rate limits, Linear API will start returning rate limit error responses. With GraphQL requests, response http status code will be 400, but you can catch these by inspecting the `errors` in the response body containing the `RATELIMITED` error code.

```json
{
  "errors": [
    {
      "message": "...",
      "extensions": {
        "code": "RATELIMITED",
        ...
      }
    }
  ]
}
```
