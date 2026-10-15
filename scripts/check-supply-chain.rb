#!/usr/bin/env ruby
# Mechanical regression checks; actionlint validates the surrounding shell/YAML.
require 'yaml'
require 'json'
root = ARGV[0] || File.expand_path('..', __dir__)
failures = []
Dir.glob(File.join(root, '.github/workflows/*.{yml,yaml}')).each do |path|
  # FORMA-187's dedicated seeded SR43 lint owns the release workflow.
  next if File.basename(path) == 'release.yml'
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
puts 'Supply-chain policy: workflow pins, locked installs, scripts-off, exact runtime dependency pass.'
