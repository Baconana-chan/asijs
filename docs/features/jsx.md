# JSX Rendering

```tsx
// tsconfig.json: { "jsx": "react-jsx", "jsxImportSource": "asijs" }

import { html } from "asijs";

app.get("/", () => html(
  <html>
    <head><title>AsiJS App</title></head>
    <body>
      <h1>Hello, JSX!</h1>
    </body>
  </html>
));
```

## Components

```tsx
function Layout({ title, children }) {
  return (
    <html>
      <head><title>{title}</title></head>
      <body>{children}</body>
    </html>
  );
}

app.get("/", () => html(
  <Layout title="Home">
    <h1>Welcome</h1>
  </Layout>
));
```

## Streaming

```typescript
import { stream, Suspense } from "asijs";

app.get("/stream", () => stream(
  <html>
    <body>
      <Suspense fallback={<p>Loading...</p>}>
        <AsyncComponent />
      </Suspense>
    </body>
  </html>
));
```

## Helpers

```typescript
import { when, each, raw, setTitle, addMeta, renderHead } from "asijs";

// Conditional rendering
{when(showHeader, <h1>Header</h1>)}

// List rendering
{each(items, (item) => <li>{item.name}</li>)}

// Raw HTML (unescaped)
{raw("<strong>bold</strong>")}

// Head management
{setTitle("Page Title")}
{addMeta({ name: "description", content: "..." })}
{renderHead()}
```
