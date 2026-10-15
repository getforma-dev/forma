# frozen_string_literal: true
# Compatibility entrypoint; run the merged repository policy from its root.
Dir.chdir(File.expand_path("../../..", __dir__))
exec("ruby", "scripts/check-release-workflow.rb", *ARGV)
