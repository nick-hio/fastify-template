# Fastify Template

## Environment Variables

| Key         | Default  | Description                                                                                              |
|-------------|----------|----------------------------------------------------------------------------------------------------------|
| `LOG_LEVEL` | `"info"` | Logging level (Available options are `"info"`, `"debug"`, `"warn"`, `"error"`, `"fatal"`, and `"trace"`) |

## Building

> Use `linux/amd64` platform for compatibility with most systems. Use `linux/arm64` for Apple Silicon Macs.

Linux / macOS:

```bash
docker buildx build \
    --platform linux/amd64 \
    --tag app-name:0.1.0 .
```

Windows:

```powershell
docker buildx build `
    --platform linux/amd64 `
    --tag app-name:0.1.0 .
```

## Running

### Docker Run

Linux / macOS:

```bash
docker run \
    -d --name my-app \
    -p 30000:3000 \
    -v "/path/to/data:/data" \
    app-name:0.1.0
```

Windows:

```powershell
docker run `
    -d --name my-app `
    -p 3000:3000 `
    -v "C:/path/to/data:/data" `
    app-name:0.1.0
```

### Docker Compose

Create `compose.yml`:

```yaml
services:
  my-app:
    image: 'app-name:0.1.0'
    container_name: my-app
    restart: unless-stopped
    ports:
      - '30000:3000'
    volumes:
      ### Windows ###
      - 'C:/path/to/appdata/my-app/data:/data'
      ### MacOS / Linux ###
      - '/path/to/appdata/my-app/data:/data'
    networks:
      - my-app-net
    environment:
      - LOG_LEVEL='debug'  # Optional (defaults to 'info')

networks:
  my-app-net:

```

Start the Compose stack:

```bash
# Linux / macOS
docker-compose -f "/path/to/compose.yml" up -d

# Windows
docker-compose -f "C:/path/to/compose.yml" up -d
```
