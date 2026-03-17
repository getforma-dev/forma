use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct Stats {
    pub users: u32,
    pub uptime: f32,
    pub revenue: u32,
    pub active_sessions: u32,
}

#[derive(Serialize, Clone)]
pub struct Activity {
    pub id: u32,
    pub message: String,
    pub time_ago: String,
    pub kind: String,
}

#[derive(Serialize, Clone)]
pub struct User {
    pub id: u32,
    pub name: String,
    pub email: String,
    pub role: String,
    pub status: String,
}

pub fn get_stats() -> Stats {
    Stats { users: 1_247, uptime: 99.8, revenue: 12_450, active_sessions: 89 }
}

pub fn get_activity() -> Vec<Activity> {
    vec![
        Activity { id: 1, message: "New user signed up".into(), time_ago: "2m ago".into(), kind: "signup".into() },
        Activity { id: 2, message: "Payment received — $249".into(), time_ago: "5m ago".into(), kind: "payment".into() },
        Activity { id: 3, message: "Monthly report generated".into(), time_ago: "12m ago".into(), kind: "report".into() },
        Activity { id: 4, message: "API deployment completed".into(), time_ago: "23m ago".into(), kind: "deploy".into() },
        Activity { id: 5, message: "New user signed up".into(), time_ago: "31m ago".into(), kind: "signup".into() },
        Activity { id: 6, message: "Payment received — $89".into(), time_ago: "45m ago".into(), kind: "payment".into() },
        Activity { id: 7, message: "Database backup completed".into(), time_ago: "1h ago".into(), kind: "deploy".into() },
        Activity { id: 8, message: "New user signed up".into(), time_ago: "2h ago".into(), kind: "signup".into() },
    ]
}

pub fn get_users() -> Vec<User> {
    vec![
        User { id: 1, name: "Alice Chen".into(), email: "alice@example.com".into(), role: "Admin".into(), status: "Active".into() },
        User { id: 2, name: "Bob Martinez".into(), email: "bob@example.com".into(), role: "User".into(), status: "Active".into() },
        User { id: 3, name: "Carol Johnson".into(), email: "carol@example.com".into(), role: "User".into(), status: "Pending".into() },
        User { id: 4, name: "David Kim".into(), email: "david@example.com".into(), role: "Viewer".into(), status: "Active".into() },
        User { id: 5, name: "Emma Wilson".into(), email: "emma@example.com".into(), role: "Admin".into(), status: "Active".into() },
        User { id: 6, name: "Frank Brown".into(), email: "frank@example.com".into(), role: "User".into(), status: "Inactive".into() },
        User { id: 7, name: "Grace Lee".into(), email: "grace@example.com".into(), role: "User".into(), status: "Active".into() },
        User { id: 8, name: "Henry Davis".into(), email: "henry@example.com".into(), role: "Viewer".into(), status: "Pending".into() },
    ]
}
