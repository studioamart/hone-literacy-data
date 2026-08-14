#!/usr/bin/env swift

import Foundation

private struct ReadingData: Codable {
    let schema: Int
    let version: Int
    let passages: [Passage]
}

private struct Passage: Codable {
    let id: String
    let title: String
    let sourceType: String
    let source: String
    let attribution: String
    let genre: String
    let level: Int
    let wordCount: Int?
    let text: String
    let questions: [Question]
    let lesson: Lesson?
    let releasedAt: String?
}

private struct Question: Codable {
    let id: String
    let skill: String
    let stem: String
    let choices: [String]
    let answer: Int
    let explanation: String
    let distractorTags: [String?]?
}

private struct DistractorTaxonomy: Codable {
    let schema: Int
    let version: Int
    let tags: [ReviewedTag]

    struct ReviewedTag: Codable {
        let id: String
        let skill: String
    }
}

private struct Lesson: Codable {
    let strategy: String
    let signals: [Signal]
    let vocab: [VocabItem]
    let skillTips: [String: String]

    struct Signal: Codable {
        let phrase: String
        let means: String
    }

    struct VocabItem: Codable {
        let word: String
        let inContext: String
    }
}

let arguments = CommandLine.arguments
guard arguments.count == 2 else {
    fputs("Usage: swift scripts/validate-swift-decode.swift PATH\n", stderr)
    exit(2)
}

do {
    let url = URL(fileURLWithPath: arguments[1])
    let data = try Data(contentsOf: url)
    let corpus = try JSONDecoder().decode(ReadingData.self, from: data)
    let taxonomyURL = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .appendingPathComponent("content/distractor-taxonomy-v1.json")
    let taxonomy = try JSONDecoder().decode(
        DistractorTaxonomy.self, from: Data(contentsOf: taxonomyURL))
    guard taxonomy.schema == 1, taxonomy.version == 1 else {
        throw ValidationError.taxonomy("schema and version must both be 1")
    }
    let reviewed = Dictionary(uniqueKeysWithValues: taxonomy.tags.map { ($0.id, $0.skill) })
    let playable = corpus.passages.filter { passage in
        !passage.questions.isEmpty && passage.questions.allSatisfy { question in
            question.choices.indices.contains(question.answer)
        }
    }
    guard playable.count == corpus.passages.count else {
        throw ValidationError.unplayable(corpus.passages.count - playable.count)
    }
    var taggedQuestions = 0
    var taggedDistractors = 0
    var totalDistractors = 0
    for passage in corpus.passages {
        for question in passage.questions {
            totalDistractors += max(0, question.choices.count - 1)
            guard let tags = question.distractorTags else { continue }
            guard tags.count == question.choices.count else {
                throw ValidationError.distractor(
                    passage.id, question.id, "tag count must equal choice count")
            }
            guard tags[question.answer] == nil else {
                throw ValidationError.distractor(
                    passage.id, question.id, "correct choice tag must be null")
            }
            var questionHasTag = false
            for index in tags.indices where index != question.answer {
                guard let raw = tags[index] else { continue }
                guard raw == raw.trimmingCharacters(in: .whitespacesAndNewlines),
                      !raw.isEmpty,
                      let expectedSkill = reviewed[raw] else {
                    throw ValidationError.distractor(
                        passage.id, question.id, "choice \(index) has an unknown/noncanonical tag")
                }
                guard question.skill == expectedSkill else {
                    throw ValidationError.distractor(
                        passage.id, question.id,
                        "choice \(index) tag \(raw) belongs to \(expectedSkill), not \(question.skill)")
                }
                taggedDistractors += 1
                questionHasTag = true
            }
            if questionHasTag { taggedQuestions += 1 }
        }
    }
    let questions = corpus.passages.reduce(0) { $0 + $1.questions.count }
    print(
        "Swift decode OK — schema \(corpus.schema), version \(corpus.version), " +
        "\(corpus.passages.count) playable passages, \(questions) questions; " +
        "distractor evidence \(taggedQuestions)/\(questions) questions, " +
        "\(taggedDistractors)/\(totalDistractors) slots."
    )
} catch {
    fputs("Swift decode failed: \(error)\n", stderr)
    exit(1)
}

private enum ValidationError: Error, CustomStringConvertible {
    case unplayable(Int)
    case taxonomy(String)
    case distractor(String, String, String)

    var description: String {
        switch self {
        case .unplayable(let count):
            return "\(count) decoded passage(s) fail PassageStore.playable"
        case .taxonomy(let message):
            return "invalid distractor taxonomy: \(message)"
        case .distractor(let passage, let question, let message):
            return "\(passage)/\(question): \(message)"
        }
    }
}
