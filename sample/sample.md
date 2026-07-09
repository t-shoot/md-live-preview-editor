# Heading 1

## Heading 2

This paragraph has **bold text**, *italic text*, ~~strikethrough~~, and `inline code`.

> A blockquote that
> spans two lines.

- Bullet item one
- Bullet item two
1. Ordered item one
2. Ordered item two

- [ ] An unchecked task
- [x] A checked task

---

A [link to example](https://example.com "Example Title") and an image:

![placeholder image](https://via.placeholder.com/150)

```java
class Greeter {
    public static void main(String[] args) {
        System.out.println("Hello, world!");
    }
}
```

```mermaid
flowchart TD
    A[Start] --> B{Is it working?}
    B -- Yes --> C[Ship it]
    B -- No --> D[Debug]
    D --> B
```

A larger diagram, for checking that Mermaid renders at full size instead of shrinking to fit (drag to pan, Ctrl+wheel or the +/- toolbar to zoom):

```mermaid
flowchart LR
    subgraph Inception
        WD[Workspace Detection] --> RA[Requirements Analysis]
        RA --> US[User Stories]
        US --> WP[Workflow Planning]
    end
    subgraph Construction
        FD[Functional Design] --> NFRA[NFR Requirements]
        NFRA --> NFRD[NFR Design]
        NFRD --> ID[Infrastructure Design]
        ID --> CG[Code Generation]
        CG --> BT[Build and Test]
    end
    subgraph Operations
        OPS[Operations]
    end
    WP --> FD
    BT --> OPS
```

| Column A | Column B |
| -------- | -------- |
| 1        | 2        |
| 3        | 4        |
