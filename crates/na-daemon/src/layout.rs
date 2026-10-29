//! Split-tree helpers. Clients edit layouts freely (drag, resize, close); the daemon only needs
//! to place new sessions (e.g. started from a phone) and to clear panes of removed sessions.

use na_protocol::{Id, LayoutNode, PaneContent, SplitDir, Tab, WorkspaceLayout};

pub const MAX_PANES: usize = 16;

pub fn new_id() -> Id {
    uuid::Uuid::new_v4().simple().to_string()[..12].to_string()
}

pub fn new_tab(title: &str) -> Tab {
    let pane = new_id();
    Tab { id: new_id(), title: title.into(), root: LayoutNode::Pane { id: pane.clone(), content: PaneContent::Empty }, focused: pane, zoomed: None }
}

pub fn default_layout() -> WorkspaceLayout {
    let tab = new_tab("Main");
    WorkspaceLayout { active_tab: tab.id.clone(), tabs: vec![tab] }
}

pub fn count_panes(n: &LayoutNode) -> usize {
    match n {
        LayoutNode::Pane { .. } => 1,
        LayoutNode::Split { children, .. } => children.iter().map(count_panes).sum(),
    }
}

fn find_pane_mut<'a>(n: &'a mut LayoutNode, pred: &dyn Fn(&Id, &PaneContent) -> bool) -> Option<&'a mut LayoutNode> {
    match n {
        LayoutNode::Pane { id, content } => {
            if pred(id, content) {
                Some(n)
            } else {
                None
            }
        }
        LayoutNode::Split { children, .. } => children.iter_mut().find_map(|c| find_pane_mut(c, pred)),
    }
}

fn set_content(n: &mut LayoutNode, new: PaneContent) -> Id {
    match n {
        LayoutNode::Pane { id, content } => {
            *content = new;
            id.clone()
        }
        LayoutNode::Split { .. } => unreachable!("set_content on split"),
    }
}

/// Puts a terminal for `sid` into the layout and focuses it. Returns the pane id.
pub fn place_session(layout: &mut WorkspaceLayout, sid: &Id, pane: Option<&Id>) -> Id {
    let content = PaneContent::Terminal { session: sid.clone() };
    // 1. the requested pane, in any tab
    if let Some(pane) = pane {
        for tab in &mut layout.tabs {
            if let Some(n) = find_pane_mut(&mut tab.root, &|id, _| id == pane) {
                let id = set_content(n, content);
                tab.focused = id.clone();
                layout.active_tab = tab.id.clone();
                return id;
            }
        }
    }
    let active = layout.tabs.iter().position(|t| t.id == layout.active_tab).unwrap_or(0);
    if layout.tabs.is_empty() {
        layout.tabs.push(new_tab("Main"));
    }
    // 2. an empty pane in the active tab, 3. a split in the active tab, 4. a new tab
    let order: Vec<usize> = std::iter::once(active).chain((0..layout.tabs.len()).filter(|i| *i != active)).collect();
    for i in order.iter().copied() {
        let tab = &mut layout.tabs[i];
        if let Some(n) = find_pane_mut(&mut tab.root, &|_, c| matches!(c, PaneContent::Empty)) {
            let id = set_content(n, content);
            tab.focused = id.clone();
            layout.active_tab = tab.id.clone();
            return id;
        }
    }
    for i in order {
        let tab = &mut layout.tabs[i];
        if count_panes(&tab.root) < MAX_PANES {
            let id = new_id();
            split_largest(&mut tab.root, LayoutNode::Pane { id: id.clone(), content });
            tab.focused = id.clone();
            tab.zoomed = None;
            layout.active_tab = tab.id.clone();
            return id;
        }
    }
    let mut tab = new_tab(&format!("Tab {}", layout.tabs.len() + 1));
    let id = set_content(&mut tab.root, content);
    layout.active_tab = tab.id.clone();
    layout.tabs.push(tab);
    id
}

/// Clears every pane that shows `sid`.
pub fn clear_session(layout: &mut WorkspaceLayout, sid: &Id) -> bool {
    fn walk(n: &mut LayoutNode, sid: &Id) -> bool {
        match n {
            LayoutNode::Pane { content, .. } => {
                if matches!(content, PaneContent::Terminal { session } if session == sid) {
                    *content = PaneContent::Empty;
                    true
                } else {
                    false
                }
            }
            LayoutNode::Split { children, .. } => children.iter_mut().fold(false, |acc, c| walk(c, sid) | acc),
        }
    }
    layout.tabs.iter_mut().fold(false, |acc, t| walk(&mut t.root, sid) | acc)
}

pub fn sessions_in(layout: &WorkspaceLayout) -> Vec<Id> {
    fn walk(n: &LayoutNode, out: &mut Vec<Id>) {
        match n {
            LayoutNode::Pane { content: PaneContent::Terminal { session }, .. } => out.push(session.clone()),
            LayoutNode::Pane { .. } => {}
            LayoutNode::Split { children, .. } => children.iter().for_each(|c| walk(c, out)),
        }
    }
    let mut out = vec![];
    layout.tabs.iter().for_each(|t| walk(&t.root, &mut out));
    out
}

/// Splits the pane with the largest on-screen area (assuming a wide window) along its longer
/// side. If the parent already splits in that direction, the new pane becomes a sibling and the
/// sizes are evened out, so repeated placement grows a tidy grid (2 → 2×1, 4 → 2×2, …).
fn split_largest(root: &mut LayoutNode, new: LayoutNode) {
    // (path, w, h) of every pane; w/h in "screen units", window assumed 16:10
    fn collect(n: &LayoutNode, path: &mut Vec<usize>, w: f32, h: f32, out: &mut Vec<(Vec<usize>, f32, f32)>) {
        match n {
            LayoutNode::Pane { .. } => out.push((path.clone(), w, h)),
            LayoutNode::Split { dir, sizes, children, .. } => {
                for (i, c) in children.iter().enumerate() {
                    let f = sizes.get(i).copied().unwrap_or(1.0 / children.len() as f32);
                    path.push(i);
                    match dir {
                        SplitDir::Row => collect(c, path, w * f, h, out),
                        SplitDir::Column => collect(c, path, w, h * f, out),
                    }
                    path.pop();
                }
            }
        }
    }
    let mut panes = vec![];
    collect(root, &mut vec![], 16.0, 10.0, &mut panes);
    // ties go to the first pane in reading order (max_by keeps the last maximum, so reverse)
    let (path, w, h) = panes
        .into_iter()
        .rev()
        .max_by(|a, b| (a.1 * a.2).partial_cmp(&(b.1 * b.2)).unwrap())
        .expect("tree has a pane");
    let want = if w >= h { SplitDir::Row } else { SplitDir::Column };

    // parent of the target
    if let Some((&last, parent_path)) = path.split_last() {
        let parent = node_at(root, parent_path);
        if let LayoutNode::Split { dir, sizes, children, .. } = parent
            && *dir == want {
                children.insert(last + 1, new);
                *sizes = vec![1.0 / children.len() as f32; children.len()];
                return;
            }
    }
    let target = node_at(root, &path);
    let old = std::mem::replace(target, LayoutNode::Pane { id: String::new(), content: PaneContent::Empty });
    *target = LayoutNode::Split { id: new_id(), dir: want, sizes: vec![0.5, 0.5], children: vec![old, new] };
}

fn node_at<'a>(n: &'a mut LayoutNode, path: &[usize]) -> &'a mut LayoutNode {
    match (path.split_first(), n) {
        (None, n) => n,
        (Some((i, rest)), LayoutNode::Split { children, .. }) => node_at(&mut children[*i], rest),
        (Some(_), n) => n,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shape(n: &LayoutNode) -> String {
        match n {
            LayoutNode::Pane { .. } => "p".into(),
            LayoutNode::Split { dir, children, .. } => format!(
                "{}({})",
                if *dir == SplitDir::Row { "R" } else { "C" },
                children.iter().map(shape).collect::<Vec<_>>().join(",")
            ),
        }
    }

    #[test]
    fn placement_grows_a_grid_then_new_tab() {
        let mut l = default_layout();
        let mut shapes = vec![];
        for i in 0..17 {
            place_session(&mut l, &format!("s{i}"), None);
            shapes.push(shape(&l.tabs[0].root));
        }
        assert_eq!(shapes[0], "p");
        assert_eq!(shapes[1], "R(p,p)");
        assert_eq!(shapes[3], "R(C(p,p),C(p,p))");
        assert_eq!(count_panes(&l.tabs[0].root), 16);
        assert_eq!(l.tabs.len(), 2);
        assert_eq!(l.active_tab, l.tabs[1].id);
        assert_eq!(sessions_in(&l).len(), 17);
    }

    #[test]
    fn requested_pane_and_clear() {
        let mut l = default_layout();
        let pane = l.tabs[0].focused.clone();
        let got = place_session(&mut l, &"a".to_string(), Some(&pane));
        assert_eq!(got, pane);
        assert!(clear_session(&mut l, &"a".to_string()));
        assert!(sessions_in(&l).is_empty());
        // empty pane is reused
        assert_eq!(place_session(&mut l, &"b".to_string(), None), pane);
    }
}
