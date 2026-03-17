use serde::Serialize;

// ── Metrics (Overview stat cards) ──
#[derive(Serialize, Clone)]
pub struct Metric {
    pub label: String,
    pub value: String,
    pub change: f32,
    pub trend: String,
}

// ── Deployment Stats (Deployments page stat cards) ──
#[derive(Serialize, Clone)]
pub struct DeploymentStats {
    pub today_deploys: u32,
    pub success_rate: f32,
    pub avg_duration: String,
    pub rollbacks: u32,
}

// ── Deployments (expanded) ──
#[derive(Serialize, Clone)]
pub struct Deployment {
    pub id: u32,
    pub service: String,
    pub version: String,
    pub branch: String,
    pub environment: String,
    pub status: String,
    pub duration_secs: u32,
    pub deployed_by: String,
    pub commit_hash: String,
    pub time_ago: String,
}

// ── Services ──
#[derive(Serialize, Clone)]
pub struct Service {
    pub name: String,
    pub status: String,
    pub uptime: f32,
    pub latency_ms: u32,
    pub region: String,
}

// ── Service Status Summary ──
#[derive(Serialize, Clone)]
pub struct ServiceStatusSummary {
    pub healthy: u32,
    pub degraded: u32,
    pub down: u32,
}

// ── Servers ──
#[derive(Serialize, Clone)]
pub struct Server {
    pub name: String,
    pub ip: String,
    pub status: String,
    pub region: String,
    pub os: String,
    pub cpu_percent: f32,
    pub memory_percent: f32,
    pub disk_percent: f32,
    pub uptime: String,
}

// ── Request Volume (chart data) ──
#[derive(Serialize, Clone)]
pub struct RequestVolumePoint {
    pub hour: String,
    pub success: u32,
    pub error: u32,
}

// ── Incidents ──
#[derive(Serialize, Clone)]
pub struct Incident {
    pub id: String,
    pub title: String,
    pub severity: String,
    pub status: String,
    pub service: String,
    pub time_ago: String,
}

// ── Data providers ──

pub fn get_metrics() -> Vec<Metric> {
    vec![
        Metric { label: "Uptime".into(), value: "99.8%".into(), change: 0.02, trend: "up".into() },
        Metric { label: "Avg Latency".into(), value: "142ms".into(), change: -8.3, trend: "down".into() },
        Metric { label: "Server Load".into(), value: "84%".into(), change: 3.2, trend: "up".into() },
        Metric { label: "Deploy Rate".into(), value: "94%".into(), change: 2.1, trend: "up".into() },
    ]
}

pub fn get_deployment_stats() -> DeploymentStats {
    DeploymentStats {
        today_deploys: 18,
        success_rate: 94.2,
        avg_duration: "3m 24s".into(),
        rollbacks: 2,
    }
}

pub fn get_deployments() -> Vec<Deployment> {
    vec![
        Deployment { id: 1, service: "api-gateway".into(), version: "v2.14.0".into(), branch: "main".into(), environment: "production".into(), status: "success".into(), duration_secs: 142, deployed_by: "Alice Chen".into(), commit_hash: "a7f3bc2".into(), time_ago: "2 min ago".into() },
        Deployment { id: 2, service: "auth-service".into(), version: "v1.8.3".into(), branch: "hotfix/auth-fix".into(), environment: "production".into(), status: "success".into(), duration_secs: 98, deployed_by: "Bob Martinez".into(), commit_hash: "e2d4f1a".into(), time_ago: "8 min ago".into() },
        Deployment { id: 3, service: "payment-processor".into(), version: "v3.2.1".into(), branch: "main".into(), environment: "staging".into(), status: "rolling".into(), duration_secs: 210, deployed_by: "CI/CD".into(), commit_hash: "b1c9d3e".into(), time_ago: "15 min ago".into() },
        Deployment { id: 4, service: "notification-svc".into(), version: "v1.4.0".into(), branch: "feat/email-templates".into(), environment: "development".into(), status: "success".into(), duration_secs: 67, deployed_by: "Carol Johnson".into(), commit_hash: "d8f2a7b".into(), time_ago: "32 min ago".into() },
        Deployment { id: 5, service: "user-service".into(), version: "v2.1.0".into(), branch: "release/2.1".into(), environment: "production".into(), status: "failed".into(), duration_secs: 312, deployed_by: "CI/CD".into(), commit_hash: "f4e6c8d".into(), time_ago: "1 hr ago".into() },
        Deployment { id: 6, service: "web-frontend".into(), version: "v4.7.2".into(), branch: "main".into(), environment: "production".into(), status: "success".into(), duration_secs: 48, deployed_by: "Emma Wilson".into(), commit_hash: "c3a1b9f".into(), time_ago: "1 hr ago".into() },
        Deployment { id: 7, service: "search-index".into(), version: "v1.2.0".into(), branch: "main".into(), environment: "staging".into(), status: "success".into(), duration_secs: 156, deployed_by: "Frank Brown".into(), commit_hash: "a9d2e5c".into(), time_ago: "2 hr ago".into() },
        Deployment { id: 8, service: "ml-pipeline".into(), version: "v0.9.4".into(), branch: "feat/model-v2".into(), environment: "development".into(), status: "cancelled".into(), duration_secs: 0, deployed_by: "Grace Lee".into(), commit_hash: "e7f8b2a".into(), time_ago: "2 hr ago".into() },
        Deployment { id: 9, service: "api-gateway".into(), version: "v2.13.9".into(), branch: "hotfix/rate-limit".into(), environment: "production".into(), status: "success".into(), duration_secs: 134, deployed_by: "Alice Chen".into(), commit_hash: "b4c6d8e".into(), time_ago: "3 hr ago".into() },
        Deployment { id: 10, service: "cache-layer".into(), version: "v1.1.2".into(), branch: "main".into(), environment: "staging".into(), status: "success".into(), duration_secs: 89, deployed_by: "CI/CD".into(), commit_hash: "d1e3f5a".into(), time_ago: "3 hr ago".into() },
        Deployment { id: 11, service: "queue-worker".into(), version: "v2.5.0".into(), branch: "main".into(), environment: "production".into(), status: "success".into(), duration_secs: 112, deployed_by: "Bob Martinez".into(), commit_hash: "f2a4b6c".into(), time_ago: "4 hr ago".into() },
        Deployment { id: 12, service: "cdn-edge".into(), version: "v1.0.3".into(), branch: "main".into(), environment: "production".into(), status: "success".into(), duration_secs: 34, deployed_by: "CI/CD".into(), commit_hash: "c8d0e2f".into(), time_ago: "4 hr ago".into() },
    ]
}

pub fn get_services() -> Vec<Service> {
    vec![
        Service { name: "API Gateway".into(), status: "healthy".into(), uptime: 99.99, latency_ms: 45, region: "us-east-1".into() },
        Service { name: "Auth Service".into(), status: "healthy".into(), uptime: 99.97, latency_ms: 89, region: "us-east-1".into() },
        Service { name: "Database Primary".into(), status: "healthy".into(), uptime: 99.99, latency_ms: 12, region: "us-east-1".into() },
        Service { name: "Cache Layer".into(), status: "degraded".into(), uptime: 98.5, latency_ms: 234, region: "us-west-2".into() },
        Service { name: "Queue Worker".into(), status: "healthy".into(), uptime: 99.95, latency_ms: 67, region: "us-west-2".into() },
        Service { name: "CDN Edge".into(), status: "healthy".into(), uptime: 100.0, latency_ms: 8, region: "global".into() },
        Service { name: "Search Index".into(), status: "healthy".into(), uptime: 99.9, latency_ms: 156, region: "us-east-1".into() },
        Service { name: "ML Pipeline".into(), status: "down".into(), uptime: 95.2, latency_ms: 0, region: "us-west-2".into() },
    ]
}

pub fn get_service_summary() -> ServiceStatusSummary {
    let services = get_services();
    ServiceStatusSummary {
        healthy: services.iter().filter(|s| s.status == "healthy").count() as u32,
        degraded: services.iter().filter(|s| s.status == "degraded").count() as u32,
        down: services.iter().filter(|s| s.status == "down").count() as u32,
    }
}

pub fn get_servers() -> Vec<Server> {
    vec![
        Server { name: "prod-web-01".into(), ip: "10.0.1.12".into(), status: "online".into(), region: "us-east-1".into(), os: "Ubuntu 22.04".into(), cpu_percent: 45.0, memory_percent: 68.0, disk_percent: 32.0, uptime: "14d 6h".into() },
        Server { name: "prod-web-02".into(), ip: "10.0.1.13".into(), status: "online".into(), region: "us-east-1".into(), os: "Ubuntu 22.04".into(), cpu_percent: 52.0, memory_percent: 71.0, disk_percent: 28.0, uptime: "14d 6h".into() },
        Server { name: "prod-api-01".into(), ip: "10.0.2.10".into(), status: "online".into(), region: "us-east-1".into(), os: "Amazon Linux 2023".into(), cpu_percent: 78.0, memory_percent: 82.0, disk_percent: 45.0, uptime: "7d 12h".into() },
        Server { name: "prod-db-01".into(), ip: "10.0.3.5".into(), status: "online".into(), region: "us-east-1".into(), os: "Ubuntu 22.04".into(), cpu_percent: 34.0, memory_percent: 91.0, disk_percent: 67.0, uptime: "30d 2h".into() },
        Server { name: "prod-cache-01".into(), ip: "10.0.4.8".into(), status: "degraded".into(), region: "us-west-2".into(), os: "Amazon Linux 2023".into(), cpu_percent: 92.0, memory_percent: 88.0, disk_percent: 54.0, uptime: "3d 8h".into() },
        Server { name: "staging-web-01".into(), ip: "10.1.1.10".into(), status: "online".into(), region: "us-west-2".into(), os: "Ubuntu 22.04".into(), cpu_percent: 12.0, memory_percent: 35.0, disk_percent: 22.0, uptime: "21d 4h".into() },
        Server { name: "staging-api-01".into(), ip: "10.1.2.10".into(), status: "online".into(), region: "us-west-2".into(), os: "Ubuntu 22.04".into(), cpu_percent: 8.0, memory_percent: 28.0, disk_percent: 19.0, uptime: "21d 4h".into() },
        Server { name: "dev-ml-01".into(), ip: "10.2.1.5".into(), status: "offline".into(), region: "us-west-2".into(), os: "Ubuntu 22.04".into(), cpu_percent: 0.0, memory_percent: 0.0, disk_percent: 78.0, uptime: "0d 0h".into() },
    ]
}

pub fn get_request_volume() -> Vec<RequestVolumePoint> {
    vec![
        RequestVolumePoint { hour: "00:00".into(), success: 1200, error: 12 },
        RequestVolumePoint { hour: "01:00".into(), success: 980, error: 8 },
        RequestVolumePoint { hour: "02:00".into(), success: 750, error: 5 },
        RequestVolumePoint { hour: "03:00".into(), success: 620, error: 3 },
        RequestVolumePoint { hour: "04:00".into(), success: 580, error: 4 },
        RequestVolumePoint { hour: "05:00".into(), success: 890, error: 6 },
        RequestVolumePoint { hour: "06:00".into(), success: 1450, error: 15 },
        RequestVolumePoint { hour: "07:00".into(), success: 2100, error: 22 },
        RequestVolumePoint { hour: "08:00".into(), success: 3200, error: 28 },
        RequestVolumePoint { hour: "09:00".into(), success: 4500, error: 45 },
        RequestVolumePoint { hour: "10:00".into(), success: 4800, error: 38 },
        RequestVolumePoint { hour: "11:00".into(), success: 5100, error: 42 },
        RequestVolumePoint { hour: "12:00".into(), success: 4900, error: 35 },
        RequestVolumePoint { hour: "13:00".into(), success: 5200, error: 48 },
        RequestVolumePoint { hour: "14:00".into(), success: 5000, error: 40 },
        RequestVolumePoint { hour: "15:00".into(), success: 4700, error: 36 },
        RequestVolumePoint { hour: "16:00".into(), success: 4400, error: 32 },
        RequestVolumePoint { hour: "17:00".into(), success: 3800, error: 28 },
        RequestVolumePoint { hour: "18:00".into(), success: 3200, error: 24 },
        RequestVolumePoint { hour: "19:00".into(), success: 2800, error: 20 },
        RequestVolumePoint { hour: "20:00".into(), success: 2400, error: 18 },
        RequestVolumePoint { hour: "21:00".into(), success: 2000, error: 15 },
        RequestVolumePoint { hour: "22:00".into(), success: 1600, error: 12 },
        RequestVolumePoint { hour: "23:00".into(), success: 1300, error: 10 },
    ]
}

pub fn get_incidents() -> Vec<Incident> {
    vec![
        Incident { id: "INC-2847".into(), title: "Database connection pool exhaustion".into(), severity: "critical".into(), status: "investigating".into(), service: "postgres-primary".into(), time_ago: "12 min ago".into() },
        Incident { id: "INC-2846".into(), title: "Cache layer latency spike (234ms avg)".into(), severity: "warning".into(), status: "monitoring".into(), service: "cache-layer".into(), time_ago: "45 min ago".into() },
        Incident { id: "INC-2845".into(), title: "ML Pipeline deployment failure — rollback initiated".into(), severity: "high".into(), status: "resolved".into(), service: "ml-pipeline".into(), time_ago: "2 hr ago".into() },
        Incident { id: "INC-2844".into(), title: "Elevated error rate on /api/v2/users endpoint".into(), severity: "medium".into(), status: "resolved".into(), service: "user-service".into(), time_ago: "4 hr ago".into() },
        Incident { id: "INC-2843".into(), title: "SSL certificate expiration warning for api.example.com".into(), severity: "low".into(), status: "resolved".into(), service: "api-gateway".into(), time_ago: "6 hr ago".into() },
    ]
}
