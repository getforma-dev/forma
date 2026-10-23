#!/usr/bin/env ruby
# Mechanical regression checks; actionlint validates the surrounding shell/YAML.
require 'yaml'
require 'json'
root = ARGV[0] || File.expand_path('..', __dir__)
failures = []

# FORMA-117: a 40-hex pin is exact but unreadable, and Dependabot's github-actions
# ecosystem rewrites a trailing `# v<version>` comment together with the SHA. Every
# SHA-pinned third-party `uses:` in every workflow (release.yml included: SR43's
# shape lint checks the pin, not this comment) therefore ends with exactly
# `# v<major>[.<minor>[.<patch>]]`, the release the SHA is. `./` local actions and
# local reusable workflows are exempt, as they are from the pin itself; a `uses:`
# that is not a 40-hex pin is S3's failure, not this one's.
VERSION_COMMENT = /\A# v\d+(?:\.\d+){0,2}\z/
# The only exceptions, each with its reason. dtolnay/rust-toolchain publishes its
# channels as branches (stable, beta, nightly, 1.NN) that it rebuilds by force-push,
# and its one tag, v1, was observed at the master tip; no release tag names a SHA.
# A commit that a rebuild drops from a channel branch can be garbage-collected
# (upstream's README warns of this), so a pin is a commit in master's history,
# commented `# master`, and passes `toolchain:` explicitly because master's
# action.yml requires it (FORMA-251). An action leaves this list when it starts
# publishing release tags.
BRANCH_PINNED = {
  'dtolnay/rust-toolchain' => {
    comments: ['# master'],
    reason: 'branch-published toolchain action with no release tags to name'
  }
}.freeze

# Aliases and merge keys (FORMA-251). The comment check reads `uses:` only where it
# is written, at jobs.<id>.uses and jobs.<id>.steps[].uses; it does not resolve YAML
# aliases (`*name`) or merge keys (`<<`). A `uses` reached only through one (a step
# `- *checkout` anchored under a top-level `x-` key, `- <<: *checkout`, `uses: *pin`,
# `- <<: {uses: ...}`) would go unchecked here, while the 40-hex pass below resolves
# it on Psych 3 and raises on an alias from Psych 4.0.1 (bundled since Ruby 3.1; CI
# runs 3.2), whose YAML.load_file is a safe load.
# Rather than reimplement anchor scoping and merge precedence, any alias or merge
# key in a workflow is rejected with its line; no workflow uses either, and
# check-release-workflow.rb already loads release.yml with `aliases: false`.
def each_indirection(node, &block)
  if node.is_a?(Psych::Nodes::Alias)
    yield node, "alias `*#{node.anchor}`"
  elsif node.is_a?(Psych::Nodes::Mapping)
    node.children.each_slice(2) do |key, value|
      next unless key.is_a?(Psych::Nodes::Scalar) && key.value == '<<' && !value.is_a?(Psych::Nodes::Alias)
      yield key, 'merge key `<<`'
    end
  end
  Array(node.children).each { |child| each_indirection(child, &block) }
end

# Yields [job name, scalar node] for each real `uses:` value: a job's reusable
# workflow or a step's action. The YAML parse, not a line scan, so that block-scalar
# text and commented-out lines never count and the scalar's end locates its comment.
def each_uses_node(document)
  return unless document && document.root.is_a?(Psych::Nodes::Mapping)
  mapping = ->(node) { node.is_a?(Psych::Nodes::Mapping) ? node.children.each_slice(2).to_a : [] }
  key = ->(node, name) { node.is_a?(Psych::Nodes::Scalar) && node.value == name }
  mapping.(document.root).each do |top, jobs|
    next unless key.(top, 'jobs')
    mapping.(jobs).each do |job_name, job|
      mapping.(job).each do |field, value|
        yield job_name.value, value if key.(field, 'uses') && value.is_a?(Psych::Nodes::Scalar)
        next unless key.(field, 'steps') && value.is_a?(Psych::Nodes::Sequence)
        value.children.each do |step|
          mapping.(step).each do |step_field, action|
            yield job_name.value, action if key.(step_field, 'uses') && action.is_a?(Psych::Nodes::Scalar)
          end
        end
      end
    end
  end
end

indirect = []
Dir.glob(File.join(root, '.github/workflows/*.{yml,yaml}')).sort.each do |path|
  lines = File.read(path, encoding: 'UTF-8').lines
  document = Psych.parse_file(path)
  each_indirection(document.root) do |node, what|
    indirect << path
    failures << "#{path}:#{node.start_line + 1}: YAML #{what}: write it out in full; the pin and version-comment checks read each `uses:` where it is written and do not follow aliases or merge keys"
  end if document
  each_uses_node(document) do |job, node|
    action = node.value
    next if action.start_with?('./') || !action.match?(/@[a-f0-9]{40}\z/)
    rest = lines[node.end_line].to_s[node.end_column..-1].to_s
    comment = rest[/\A\s+(#.*?)\s*\z/, 1]
    exception = BRANCH_PINNED[action.split('@').first]
    next if comment && (comment.match?(VERSION_COMMENT) || (exception && exception[:comments].include?(comment)))
    also = exception ? " or #{exception[:comments].map { |c| "`#{c}`" }.join(' or ')} (#{exception[:reason]})" : ''
    failures << "#{path}:#{node.start_line + 1}: #{job}: #{action} needs a trailing `# v<major>[.<minor>[.<patch>]]`#{also} comment naming its release (found: #{comment || 'none'})"
  end
end

Dir.glob(File.join(root, '.github/workflows/*.{yml,yaml}')).each do |path|
  # FORMA-187's dedicated seeded SR43 lint owns the release workflow.
  next if File.basename(path) == 'release.yml'
  # Already rejected above; from Psych 4.0.1 YAML.load_file would raise on its aliases.
  next if indirect.include?(path)
  doc = YAML.load_file(path)
  (doc['jobs'] || {}).each do |name, job|
    (job['steps'] || []).each do |step|
      action = step['uses']
      if action && !action.start_with?('./') && !action.match?(/@[a-f0-9]{40}\z/)
        failures << "#{path}: #{name}: action must be pinned by SHA: #{action}"
      end
      run = step['run'].to_s.lines.reject { |line| line.lstrip.start_with?('#') }.join
      failures << "#{path}: #{name}: retired core-release dispatch" if run.match?(/core-release|DISPATCH_TOKEN/)
      run.lines.each do |line|
        if line.match?(/\bnpm\s+ci\b/) && !line.include?('--ignore-scripts')
          failures << "#{path}: #{name}: npm ci needs --ignore-scripts"
        end
        if line.match?(/\bcargo\s+(build|check|test|clippy|doc|tree)\b/) && !line.include?('--locked')
          failures << "#{path}: #{name}: Cargo command needs --locked"
        end
      end
    end
  end
end
pkg = JSON.parse(File.read(File.join(root, 'packages/core/package.json')))
failures << 'alien-signals must be exactly 3.1.2' unless pkg.dig('dependencies','alien-signals') == '3.1.2'
%w[. packages/create-app/templates/minimal/admin packages/create-app/templates/dashboard/admin].each do |folder|
  config = File.join(root, folder, folder == '.' ? '.npmrc' : '_npmrc')
  failures << "#{folder}: missing ignore-scripts=true" unless File.exist?(config) && File.read(config).lines.any? { |l| l.strip == 'ignore-scripts=true' }
end
abort failures.join("\n") unless failures.empty?
puts 'Supply-chain policy: workflow pins and version comments, locked installs, scripts-off, exact runtime dependency pass.'
