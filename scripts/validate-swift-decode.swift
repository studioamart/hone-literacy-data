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
    let playable = corpus.passages.filter { passage in
        !passage.questions.isEmpty && passage.questions.allSatisfy { question in
            question.choices.indices.contains(question.answer)
        }
    }
    guard playable.count == corpus.passages.count else {
        throw ValidationError.unplayable(corpus.passages.count - playable.count)
    }
    let questions = corpus.passages.reduce(0) { $0 + $1.questions.count }
    print(
        "Swift decode OK — schema \(corpus.schema), version \(corpus.version), " +
        "\(corpus.passages.count) playable passages, \(questions) questions."
    )
} catch {
    fputs("Swift decode failed: \(error)\n", stderr)
    exit(1)
}

private enum ValidationError: Error, CustomStringConvertible {
    case unplayable(Int)

    var description: String {
        switch self {
        case .unplayable(let count):
            return "\(count) decoded passage(s) fail PassageStore.playable"
        }
    }
}
